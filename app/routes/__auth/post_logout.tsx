/*!
 * Copyright © 2022 United States Government as represented by the Administrator
 * of the National Aeronautics and Space Administration. No copyright is claimed
 * in the United States under Title 17, U.S. Code. All Other Rights Reserved.
 *
 * SPDX-License-Identifier: NASA-1.3
 */

import type { LoaderArgs } from '@remix-run/node'
import { redirect } from '@remix-run/node'
import { Form, Link, useLoaderData } from '@remix-run/react'
import {
  Button,
  Modal,
  ModalFooter,
  ModalHeading,
} from '@trussworks/react-uswds'
import { storage } from './auth.server'

export const handle = {
  getSitemapEntries: () => null,
}

export async function loader({ request: { headers } }: LoaderArgs) {
  const session = await storage.getSession(headers.get('Cookie'))
  const existingIdp = session.get('existingIdp')
  if (session.id) await storage.destroySession(session)

  if (existingIdp) return { existingIdp }
  else return redirect('/')
}

export default function PostLogout() {
  const { existingIdp } = useLoaderData()
  const friendlyExistingIdp =
    existingIdp == 'COGNITO' ? 'email and password' : existingIdp
  return (
    <Modal
      id="modal-existing-idp"
      aria-labelledby="modal-existing-idp"
      aria-describedby="modal-existing-idp-description"
      isInitiallyOpen={true}
      forceAction={true}
      renderToPortal={false}
    >
      <ModalHeading id="modal-existing-idp-heading">
        That email address is already registered
      </ModalHeading>
      <div id="modal-existing-idp-description">
        <p>
          You already have an existing account with the same email address. Last
          time that you signed in, you used <b>{friendlyExistingIdp}</b>. Would
          you like to try signing in that way again?
        </p>
        <p className="text-base">
          To change your sign-in method,{' '}
          <a href="https://heasarc.gsfc.nasa.gov/cgi-bin/Feedback?selected=kafkagcn">
            contact us for help
          </a>
          .
        </p>
      </div>
      <ModalFooter>
        <Form action="/login">
          <input type="hidden" name="identity_provider" value={existingIdp} />
          <Link to="/">
            <Button type="button" outline>
              Cancel
            </Button>
          </Link>
          <Button type="submit" className="btn-default">
            Sign in using {friendlyExistingIdp}
          </Button>
        </Form>
      </ModalFooter>
    </Modal>
  )
}
