/*!
 * Copyright © 2022 United States Government as represented by the Administrator
 * of the National Aeronautics and Space Administration. No copyright is claimed
 * in the United States under Title 17, U.S. Code. All Other Rights Reserved.
 *
 * SPDX-License-Identifier: NASA-1.3
 */

import {
  ListUsersInGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import type { SNSEventRecord } from 'aws-lambda'

import { simpleParser } from 'mailparser'

import {
  subjectIsValid,
  formatAuthor,
  bodyIsValid,
} from '../../routes/circulars/circulars.lib'

import {
  extractAttributeRequired,
  extractAttribute,
} from '~/lib/cognito.server'
import { group, putRaw } from '~/routes/circulars/circulars.server'
import { sendEmail } from '~/lib/email.server'
import { feature, getOrigin } from '~/lib/env.server'
import { tables } from '@architect/functions'
import { createTriggerHandler } from '~/lib/lambdaTrigger.server'

interface UserData {
  email: string
  sub?: string
  name?: string
  affiliation?: string
}

const fromName = 'GCN Circulars'

const cognito = new CognitoIdentityProviderClient({})
const origin = getOrigin()

// FIXME: must use module.exports here for OpenTelemetry shim to work correctly.
// See https://dev.to/heymarkkop/how-to-solve-cannot-redefine-property-handler-on-aws-lambda-3j67
module.exports.handler = createTriggerHandler(
  async (record: SNSEventRecord) => {
    if (!feature('circulars')) throw new Error('not implemented')
    const message = JSON.parse(record.Sns.Message)

    if (!message.receipt) throw new Error('Message Receipt content missing')

    if (
      ![
        message.receipt.spamVerdict,
        message.receipt.virusVerdict,
        message.receipt.spfVerdict,
        message.receipt.dkimVerdict,
        message.receipt.dmarcVerdict,
      ].every((verdict) => verdict.status === 'PASS')
    )
      throw new Error('Message caught in virus/spam detection.')

    if (!message.content) throw new Error('Object has no body')

    const parsed = await simpleParser(
      Buffer.from(message.content, 'base64').toString()
    )

    if (!parsed.from) throw new Error('Email has no sender')

    const userEmail = parsed.from.value[0].address
    if (!userEmail)
      throw new Error(
        'Error parsing sender email from model: ' + JSON.stringify(parsed.from)
      )

    if (
      !parsed.subject ||
      !subjectIsValid(parsed.subject) ||
      !parsed.text ||
      !bodyIsValid(parsed.text)
    ) {
      await sendEmail({
        fromName,
        recipient: userEmail,
        subject:
          'GCN Circular Submission Warning: Invalid subject or body structure',
        body: `The submission of your Circular has been rejected, as the subject line and body do not conform to the appropriate format. Please see ${origin}/circulars/classic#submission-process for more information.`,
      })
      return
    }

    const userData =
      (await getCognitoUserData(userEmail)) ??
      (await getLegacyUserData(userEmail))

    if (!userData) {
      await sendEmail({
        fromName,
        recipient: userEmail,
        subject: 'GCN Circular Submission Warning: Missing permissions',
        body: 'You do not have the required permissions to submit GCN Circulars. If you believe this to be a mistake, please fill out the form at https://heasarc.gsfc.nasa.gov/cgi-bin/Feedback?selected=kafkagcn, and we will look into resolving it as soon as possible.',
      })
      return
    }

    const circular = {
      subject: parsed.subject,
      body: parsed.text,
      sub: userData.sub,
      submitter: formatAuthor(userData),
    }

    // Removes sub as a property if it is undefined from the legacy users
    if (!circular.sub) delete circular.sub
    const newCircularId = await putRaw(circular)

    // Send a success email
    await sendEmail({
      fromName: 'GCN Circulars',
      recipient: userEmail,
      subject: `Successfully submitted Circular: ${newCircularId}`,
      body: `Your circular has been successfully submitted. You may view it at ${origin}/circulars/${newCircularId}`,
    })
  }
)

/**
 * Returns a UserData object constructed from cognito if the
 * user is in the Submitters group
 * @param userEmail
 */
async function getCognitoUserData(
  userEmail: string
): Promise<UserData | undefined> {
  const data = await cognito.send(
    new ListUsersInGroupCommand({
      GroupName: group,
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
    })
  )
  const userTypeData = data.Users?.find(
    (user) => extractAttributeRequired(user, 'email') == userEmail
  )
  return (
    userTypeData && {
      sub: extractAttributeRequired(userTypeData, 'sub'),
      email: extractAttributeRequired(userTypeData, 'email'),
      name: extractAttribute(userTypeData, 'name'),
      affiliation: extractAttribute(userTypeData, 'custom:affiliation'),
    }
  )
}

/**
 * Returns a UserData object constructed from the legacy_users table
 * or undefined if none exists
 * @param userEmail
 */
async function getLegacyUserData(
  userEmail: string
): Promise<UserData | undefined> {
  const db = await tables()
  const data = await db.legacy_users.get({ email: userEmail })
  return (
    data && {
      email: data.email,
      name: data.name,
      affiliation: data.affiliation,
    }
  )
}
