import Crawler from '../src'

describe('Crawler', function () {
  jest.setTimeout(30000);

  it('add', function (done) {
    const crawler = new Crawler()

    crawler.onNewNode(quad => {
      if (quad) {
        console.log(quad.subject.value)
        expect(0).toBe(7)
        done()
      }
    })

    crawler.run('http://www.wikidata.org/entity/Q95716156')
  })
})