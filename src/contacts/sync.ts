import { upsertContact } from './client'

const PEOPLE_API = 'https://people.googleapis.com/v1'

interface PersonName {
  displayName?: string
}

interface EmailAddress {
  value?: string
}

interface Person {
  names?: PersonName[]
  emailAddresses?: EmailAddress[]
}

interface ConnectionsResponse {
  connections?: Person[]
  nextPageToken?: string
}

export async function syncGoogleContacts(accessToken: string): Promise<number> {
  let count = 0
  let pageToken: string | undefined

  do {
    const url = new URL(`${PEOPLE_API}/people/me/connections`)
    url.searchParams.set('personFields', 'names,emailAddresses')
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`People API ${res.status}: ${await res.text()}`)

    const data = await res.json() as ConnectionsResponse
    pageToken = data.nextPageToken

    for (const person of data.connections ?? []) {
      const name = person.names?.[0]?.displayName ?? ''
      for (const ea of person.emailAddresses ?? []) {
        if (ea.value) {
          upsertContact(ea.value, name, 'google_contacts')
          count++
        }
      }
    }
  } while (pageToken)

  return count
}
