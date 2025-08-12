const assert = require("assert");
const { add, multiply } = require("./app.js");

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(err.message);
  }
}

// TESTS
test("add() adds numbers correctly", () => {
  assert.strictEqual(add(2, 3), 5);
  assert.strictEqual(add(-2, 3), 1);
});

test("multiply() multiplies numbers correctly", () => {
  assert.strictEqual(multiply(2, 3), 6);
  assert.strictEqual(multiply(-2, 3), -6);
});
