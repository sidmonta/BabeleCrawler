import { includes, replace, ifElse, identity, pipe } from "ramda"
import { Tools } from '@sidmonta/babelelibrary'

type URI = string

type control = (is?: string, change?: (uri: URI) => URI) => string | control

export const createCheck = (is: string, change: (uri: URI) => URI) => ifElse(includes(is), change, identity)

// Wikidata
export const checkWikidata: (uri: URI) => string = createCheck('wikidata', replace(/entity/, 'wiki/Special:EntityData'))
// VIAF
export const checkViaf: (uri: URI) => string = createCheck('viaf', (uri: URI) => uri + '/rdf.xml')

export const allCheck = pipe(checkWikidata, checkViaf)

function baseChangeURI() {

  let aggregate: Tools.NonEmptyArray<(uri: URI) => URI> = [checkWikidata, checkViaf]
  const control = (is?: string, change?: (uri: URI) => URI) => {
    if (is && change) {
      aggregate.push(createCheck(is, change))
      return control
    } else if (is) {
      // @ts-ignore
      return pipe(...aggregate)(is)
    }
    // @ts-ignore
    return pipe(...aggregate)
  }
  return control
}

export const changeUri: control = baseChangeURI()
