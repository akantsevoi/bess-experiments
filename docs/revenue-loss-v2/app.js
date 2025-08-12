function readFile(reader, file) {
  return new Promise((resolve, reject) => {
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (err) => reject(err);
    reader.readAsText(file);
  });
}

async function runCalculation() {
  const priceFile = document.getElementById('priceFile').files[0];
  const batteryFile = document.getElementById('batteryFile').files[0];
  const predFile = document.getElementById('predFile').files[0];
  const actFile = document.getElementById('actFile').files[0];

  const files = { priceFile, batteryFile, predFile, actFile };
  let output = '';
  for (const [name, file] of Object.entries(files)) {
    if (file) {
      const text = await readFile(new FileReader(), file);
      output += `=== ${name} ===\n${text}\n\n`;
    } else {
      output += `=== ${name} ===\n(no file selected)\n\n`;
    }
  }
  document.getElementById('output').textContent = output;
}

function setup() {
  const runBtn = document.getElementById('runBtn');
  if (runBtn) {
    runBtn.addEventListener('click', runCalculation);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', setup);
}

if (typeof module !== 'undefined') {
  module.exports = { readFile };
}
