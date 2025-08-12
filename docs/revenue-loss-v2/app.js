function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

if (typeof module !== "undefined") {
  module.exports = { add, multiply };
}
