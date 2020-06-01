import Crawler from '../src'

describe('Crawler', function () {
  jest.setTimeout(300000);

  it('test', function (done) {
    const crawler = new Crawler()

    crawler.getNewNodeStream().subscribe(quad => {
      // console.log(quad.subject.value)
      expect(quad).not.toBe(null)
    }, console.error, () => {
      console.log('FINE')
      done()
    })

    crawler.getNewSourceStream().subscribe(source => {
      expect(source).not.toBe(null)
    }, console.error, () => {
      console.log('FINE')
    })

    crawler.run('https://viaf.org/viaf/34644407')
  })
})
