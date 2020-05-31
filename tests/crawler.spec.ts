import Crawler from '../src'

describe('Crawler', function () {
  jest.setTimeout(300000);

  it('add', function (done) {
    const crawler = new Crawler()

    crawler.getNewNodeStream().subscribe(quad => {
      // console.log(quad.subject.value)
      expect(quad).not.toBe(null)
    }, console.error, done)

    crawler.getNewSourceStream().subscribe(source => {
      expect(source).not.toBe(null)
    }, console.error, done)

    crawler.run('https://viaf.org/viaf/34644407')
  })
})