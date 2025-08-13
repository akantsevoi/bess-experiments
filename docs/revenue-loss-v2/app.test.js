const assert = require('assert');
const { readFile } = require('./app.js');
const fs = require('fs');
const path = require('path');

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(err.message);
  }
}

(async () => {
  await test('readFile resolves with provided content', async () => {
    class MockReader {
      readAsText(file) {
        setTimeout(() => this.onload({ target: { result: file } }), 0);
      }
    }
    const content = await readFile(new MockReader(), 'hello world');
    assert.strictEqual(content, 'hello world');
  });

  await test('readFile reads content from sample file', async () => {
    class MockReader {
      readAsText(filePath) {
        fs.readFile(filePath, 'utf8', (err, data) => {
          if (err) {
            this.onerror(err);
          } else {
            this.onload({ target: { result: data } });
          }
        });
      }
    }
    const filePath = path.join(__dirname, 'files/price_15min.json');
    const content = await readFile(new MockReader(), filePath);
    const expected = fs.readFileSync(filePath, 'utf8');
    assert.strictEqual(content, expected);
  });
})();
