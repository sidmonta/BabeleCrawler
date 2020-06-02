# Babele Crawler
Il crawler qui sviluppato è il componente del progetto Babele che si occupa di recuperare le triple RDF associate ad un soggetto.

Il meccanismo di funzionamento del Crawler è semplice: partendo da una URI che identifica un soggetto effettua una chiamata alla risorsa associata a quell’URI per recuperarne tutte le triple RDF associate.

La caratteristica del Crawler è quella di seguire le connessioni ad altre risorse che descrivono il soggetto, connessioni definite tramite triple con predicato ```owl:sameAs``` o un suo sinonimo. In questo modo è possibile recuperare tutte le triple associate al soggetto anche provenienti da servizi diversi grazie alla natura dei Linked Open Data che, come dice il nome, sono dati connessi tra loro.

Il Crawler gestisce i dati recuperati tramite stream a cui ci si può sottoscrivere per essere notificati per ogni nuova tripla recuperata e per ogni nuovo servizio raggiunto.