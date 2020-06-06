import { identity, pipe, includes, isNil, equals } from 'ramda'
import { Quad, Store, N3Store } from 'n3'
import { Observable, Subject, Subscription } from 'rxjs'
import { delay, filter, mergeMap, tap } from 'rxjs/operators'
import { Lod, Rx, Services } from '@sidmonta/babelelibrary'
import extractDomain from 'extract-domain'

/**
 * Semplice alias per definire il tipo di una URI
 */
type URI = string

/**
 * Definisce la tipologia della funzione che controlla le uri
 */
export type CheckURI = (uri: URI) => URI

/**
 * Alias della funzione getID della libreria per estrarre l'id da una URI
 * @param uri uri da cui estrarre l'identificativo
 */
const getID = (uri: URI) => Lod.getID(uri) || ''

/**
 * Genera un filtro per uno stream RxJs che dato uno id di un'URI filtra tutte le triple che contengono
 * quell'identificativo
 * @param id identificativo di una URI
 */
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
  ]) || includes(node.predicate.value, 'prop/direct-normalized')
    ? node.object.value
    : ''

/**
 * Funzione che determina se una tripla è una tripla vuota
 * @param quad tripla da verificare
 */
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
  /**
   * Salva la lista di identificativi di un soggetto così da non caricare più volte le stesse informazioni.
   * In pratica risolve il problema dei cappi nel grafo delle risorse dei RDF
   */
  private historyID: Set<string> = new Set<string>()

  /**
   * Repository che contiene tutte le triple analizzate per un soggetto.
   * Questo registro è utile perché l'oggetto N3Store mette a disposizione dei metodi per navigare agilmente il registro
   */
  public quadStore: N3Store = new Store()

  /**
   * Soggetto, cioè l'emettitore degli eventi, per le triple che contengono <sameAs>
   */
  private sameAs: Subject<URI> = new Subject<URI>()
  /**
   * Soggetto, cioè l'emettitore degli eventi, per tutte le triple ricavate dalla scansione
   */
  private quadUpcoming: Subject<Quad> = new Subject<Quad>()

  /**
   * Stream delle triple che contengono il predicato <sameAs>
   */
  public sameAs$: Observable<URI> = this.sameAs.asObservable()
  /**
   * Stream delle triple che vengono ricavate durante la scansione
   */
  public quadUpcoming$: Observable<Quad> = this.quadUpcoming.asObservable()

  /**
   * Stream di tutte le chiamate fetch ai servizi.
   */
  private download$: Observable<Quad>
  /**
   * Oggetto che contiene la sottoscrizione allo stream delle chiamate fetch ai servizi
   */
  private subscribeDownload: Subscription

  /**
   * Plugin da utilizzare per cachere le risorse che vengono salvate.
   */
  private cachePlugin: Services.CachePlugin<URI, void>

  /**
   * Tiene traccia del numero di risorse "sameAs" ancora da analizzare
   */
  private counterSameAs: number = 0

  /**
   * Costruttore del Crawler
   * @param [checkUri] funzione opzionale che trasforma le URI nella versione per ritornare il file RDF
   */
  constructor (checkUri: CheckURI = identity) {
    // Funzione che si fa la fetch al servizio LOD per una determinata URI
    // Prima applica le modifiche all'URI per il servizio richiesto
    const fetchURI = pipe(checkUri, Rx.fetchSPARQL)
    // Istanzia una cache di default. Il plugin può essere sostituita in seguito
    this.cachePlugin = new Services.InMemoryPlugin<string, void>()

    /**
     * Funzione che si occupa di fare la chiamata all'URI, filtrando le triple ritornate solo per quelle che
     * corrispondono all'identificativo del soggetto e che non sono vuote.
     * @param uri
     * @return Observable<Quad> Lo stream delle quadruple ricavate dalla fetch della risorsa
     */
    const donwloadRDF = (uri: URI): Observable<Quad> => {
      const id = getID(uri)
      this.historyID.add(id) // Mi salvo l'identificativo cercato per non cercarlo di nuovo successivamente.
      const fetch$ = fetchURI(uri).pipe(
        filterQuadByIncludedService(id), // Filtro le triple solo che appartengono all'identificativo del soggetto
        filter(filtQuad) // Filtro le triple che non sono vuote.
      )

      /**
       * Tramite questo stream tengo traccia del fatto che si sta o meno ancora analizzando dei sameAs.
       */
      fetch$
        .pipe(delay(100)) // Per ovviare al fatto che prima voglio si attivi la sottoscrizione di this.download$
        .subscribe(
          _ => {}, // Ad ogni nuova tripla non faccio nulla.
          _ => {}, // Lo stesso se viene generato un errore
          () => {
            // Il sameAs è analizzato, allora lo tolgo dal conteggio
            this.counterSameAs--
            // Se non ho più sameAs da analizzare completo gli stream.
            if (this.counterSameAs === 0) {
              this.sameAs.complete()
              this.quadUpcoming.complete()
            }
          })

      return fetch$
    }

    /**
     * Genero lo stream dei download a partire dallo stream di triple <sameAs> che non ho già analizzato.
     */
    this.download$ = this.sameAs$.pipe(
      filter((uri: URI) => !this.historyID.has(getID(uri))), // Filtro solo i sameAs già analizzati
      tap(_ => { this.counterSameAs++ }), // Incremento il counter per monitorare l'uso di un altro sameAs
      mergeMap(donwloadRDF) // Passo lo stream dei <sameAs> con lo stream delle chiamate fetch
    )

    // Sottoscrivo allo streaming delle chiamate
    this.subscribeDownload = this.download$.subscribe((quad: Quad) => {
      const sameAs = checkSameAs(quad) // Recupero, se presente il valore del predicato <sameAs>
      // Controllo se è presente il tag <sameAs> e se non ho già analizzato quel servizio
      if (sameAs && !this.sameDomain(sameAs)) {
        this.sameAs.next(sameAs) // Genero un nuovo evento nello stream dei sameAs
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
  run (uri: URI) {
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
  public onNewNode (callback: (v: Quad) => void, fil?: string): void {
    let filterQuad = fil ? Lod.checkQuad(fil) : _ => true
    this.quadUpcoming$
      .pipe(filter((q: Quad) => q && filterQuad(q)))
      .subscribe(callback)
  }

  /**
   * Metodo/evento per essere notificati ogni qual volta si è trovata una nuova base dati LOD
   * @param {(url: string) => void)} callback funzione da eseguire ogni qualvolta si è trovata una nuova banca dati da scansionare
   */
  public onNewSource (callback: (url: string) => void): void {
    this.sameAs$.subscribe(callback)
  }

  /**
   * Ritorna lo stream in cui ogni evento è una tripla trovata durante la ricerca.
   * @param fil Filtra le triple solo se contengono il valore di fil
   */
  public getNewNodeStream (fil?: string) {
    let filterQuad = fil ? Lod.checkQuad(fil) : _ => true
    return this.quadUpcoming$.pipe(filter((q: Quad) => q && filterQuad(q)))
  }

  /**
   * Ritorna lo stream per le triple <sameAs> che corrispondono ai servizi analizzati durante la navigazione
   */
  public getNewSourceStream () {
    return this.sameAs$
  }

  /**
   * Interrompe il crawler
   */
  public end (): void {
    this.subscribeDownload.unsubscribe()
    this.quadUpcoming.unsubscribe()
    this.sameAs.unsubscribe()
  }

  /**
   * Re-inizializza il crawler resettando i vari registri di informazioni
   */
  public clear (): void {
    this.quadStore = new Store()
    this.historyID = new Set<string>()
    this.cachePlugin.flush()
  }

  /**
   * Imposta il plugin di cache da utilizzare durante la navigazione
   * @param plugin plugin per la cache
   */
  public setCache (plugin: Services.CachePlugin<string, never>): void {
    this.cachePlugin = plugin
  }

  /**
   * Controlla se ho già scansionato un URI, così da non incorrere in cicli infiniti di <sameAs>
   * @param domain dominio che si sta analizzando
   * @returns {boolean} se ho già analizzato qulla URI
   */
  private sameDomain (domain: URI): boolean {
    let dom = extractDomain(domain) // estrae il dominio di dall'URI
    if (isNil(dom) || this.cachePlugin.has(dom)) {
      return true
    } else {
      this.cachePlugin.add(dom)
      return false
    }
  }
}
