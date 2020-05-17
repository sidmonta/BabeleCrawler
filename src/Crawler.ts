import { identity, pipe, includes, isNil, curry } from 'ramda'
import { Quad, Store, N3Store } from 'n3'
import { Observable, Subject, Subscription } from 'rxjs'
import { filter, mergeMap } from 'rxjs/operators'
import { Lod, Rx } from '@sidmonta/babelelibrary'
import extractDomain from 'extract-domain'
import { allCheck } from './changeUri'

type URI = string

export type CheckURI = (uri: URI) => URI

const getID = (uri: URI) => Lod.getID(uri) || ''

const filterQuadByIncludedService = (id: URI) => filter((quad: Quad) => quad.subject.value.includes(id))

/**
 * Verifica se una tripla è un <sameAs>
 * @param {Quad} node tripla da controllare
 * @returns {URI} il valore del <sameAs> o false se non è un <sameAs>
 */
const checkSameAs: (node: Quad) => URI = (node: Quad): URI =>
  includes(node.predicate.value, [
    'http://www.w3.org/2002/07/owl#sameAs',
    'http://schema.org/sameAs'
  ])
    ? node.object.value
    : ''


export const filtQuad = (quad: Quad): boolean =>
  !equals('BlankNode', quad.subject.termType) &&
  !equals(
    'http://www.w3.org/2000/01/rdf-schema#comment',
    quad.predicate.value
  ) &&
  !quad.subject.value.includes('/statement/')

/**
 * Crawler permette a partire da un nodo di recuperare tutti i nodi associati e se esistono relazioni di tipo <sameAs>
 * recupera indicazioni anche su di esse, così finché trova <sameAs>
 *
 * Scansiona le banche dati LOD connesse che si riferiscono al nodo passato come argomento.
 *
 * @example ```
 * const crawler = new Crawler()
 *
 * crawler.onNewNode(quad => {
 *   if (quad) {
 *     console.log(quad.subject.value)
 *   }
 * })
 *
 * crawler.run('https://datilod.promemoriagroup.eu/regioOPERE_LOD_ENT92')
 * ```
 *
 * Il Crawler registra uno store di triple per poter lavora più agilmente su tutte le triple trovate
 */
export default class Crawler {
  private history: Set<URI> = new Set<URI>()
  private historyID: Set<string> = new Set<string>()

  public quadStore: N3Store = new Store()

  private sameAs: Subject<URI> = new Subject<URI>()
  private quadUpcoming: Subject<Quad> = new Subject<Quad>()

  public sameAs$: Observable<URI> = this.sameAs.asObservable()
  public quadUpcoming$: Observable<Quad> = this.quadUpcoming.asObservable()

  private download$: Observable<Quad>
  private subscribeDownload: Subscription

  constructor(checkUri: CheckURI = identity) {
    const checkURIForDownload = pipe(allCheck, checkUri)
    const fetchURI = pipe(checkURIForDownload, Rx.fatchSPARQL)

    const donwloadRDF = (uri: URI) => {
      const id = getID(uri)
      this.historyID.add(id)
      return fetchURI(uri).pipe(
        filterQuadByIncludedService(id),
        filter(filtQuad)
      )
    }

    this.download$ = this.sameAs$.pipe(
      filter((uri: URI) => !this.historyID.has(getID(uri))),
      mergeMap(donwloadRDF)
    )

    this.subscribeDownload = this.download$.subscribe((quad: Quad) => {
      const sameAs = checkSameAs(quad)
      if (sameAs && !this.sameDomain(sameAs)) {
        this.sameAs.next(sameAs)
      }

      // Aggiungo le informazioni al quadUpcoming e allo store di triple
      this.quadUpcoming.next(quad)
      this.quadStore.addQuad(quad)
    })
  }

  /**
   * Incomincia a cercare tutte le triple associate a questa URI anche su altre banche dati
   * @param uri uri da cui partire per la ricerca
   */
  run(uri: URI) {
    if (!this.sameDomain(uri)) {
      this.sameAs.next(uri)
    }
    return this.quadUpcoming$
  }

  /**
   * Metodo/evento per essere notificati ad ogni nuova tripla trovata dal crawler
   * @param {(v: Quad) => void} callback funzione da eseguire ogni qualvolta si presenti un nuvo nodo
   * @param {string} [fil] regex per filtrare le query che arrivano e ottenere solo quelle desiderate.
   * Parametro opzionale
   */
  onNewNode(callback: (v: Quad) => void, fil?: string): void {
    let filterQuad = fil ? Lod.checkQuad(fil) : curry(_ => true)
    this.quadUpcoming$
      .pipe(filter((q: Quad) => q && filterQuad(q)))
      .subscribe(callback)
  }

  /**
   * Metodo/evento per essere notificati ogni qual volta si è trovata una nuova base dati LOD
   * @param {(url: string) => void)} callback funzione da eseguire ogni qualvolta si è trovata una nuova banca dati da scansionare
   */
  onNewSource(callback: (url: string) => void): void {
    this.sameAs$.subscribe(callback)
  }

  getNewNodeStream(fil?: string) {
    let filterQuad = fil ? Lod.checkQuad(fil) : curry(_ => true)
    return this.quadUpcoming$.pipe(filter((q: Quad) => q && filterQuad(q)))
  }

  getNewSourceStream() {
    return this.sameAs$
  }

  /**
   * Interrompe il crawler
   */
  end(): void {
    this.subscribeDownload.unsubscribe()
    this.quadUpcoming.unsubscribe()
    this.sameAs.unsubscribe()
  }

  clear(): void {
    this.quadStore = new Store()
    this.history = new Set<URI>()
    this.historyID = new Set<string>()
  }

  /**
   * Controlla se ho già scansionato un URI, così da non incorrere in cicli infiniti di <sameAs>
   * @param domain dominio che si sta analizzando
   * @returns {boolean} se ho già analizzato qulla URI
   */
  private sameDomain(domain: URI): boolean {
    let dom = extractDomain(domain)

    if (isNil(dom) || this.history.has(dom)) {
      return true
    } else {
      this.history.add(dom)
      return false
    }
  }
}
