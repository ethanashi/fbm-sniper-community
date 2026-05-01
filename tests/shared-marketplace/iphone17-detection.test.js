import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function extractFunction(file, name, context = {}) {
  const source = fs.readFileSync(path.resolve(file), "utf8");
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Could not find ${name} in ${file}`);

  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }

  assert.notEqual(end, -1, `Could not parse ${name} in ${file}`);
  return vm.runInNewContext(`(${source.slice(start, end)})`, context);
}

function extractConstArray(file, name, context = {}) {
  const source = fs.readFileSync(path.resolve(file), "utf8");
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Could not find ${name} in ${file}`);
  const end = source.indexOf("];", start);
  assert.notEqual(end, -1, `Could not parse ${name} in ${file}`);
  vm.runInNewContext(`${source.slice(start, end + 2)}; this.${name} = ${name};`, context);
  return context;
}

test("Facebook detects iPhone 17 target text", () => {
  const normalize = extractFunction("lib/facebook-sniper.js", "normalize");
  const context = extractConstArray("lib/facebook-sniper.js", "IPHONE_PATTERNS", { normalize });
  const detectIphoneModel = extractFunction("lib/facebook-sniper.js", "detectIphoneModel", context);
  assert.equal(detectIphoneModel("Apple iPhone 17 Pro Max 256GB"), "iphone 17 pro max");
});

test("Wallapop detects iPhone 17 target text", () => {
  const normalize = extractFunction("lib/wallapop-sniper.js", "normalize");
  const context = extractConstArray("lib/wallapop-sniper.js", "IPHONE_PATTERNS", { normalize });
  const detectIphoneModel = extractFunction("lib/wallapop-sniper.js", "detectIphoneModel", context);
  assert.equal(detectIphoneModel("iPhone 17 Pro 128gb"), "iphone 17 pro");
});

test("Vinted detects iPhone 17 target text", () => {
  const normalize = extractFunction("lib/vinted-sniper.js", "normalize");
  const context = extractConstArray("lib/vinted-sniper.js", "MODEL_KEYS", { normalize });
  const detectModel = extractFunction("lib/vinted-sniper.js", "detectModel", context);
  assert.equal(detectModel("iPhone 17 Plus 256GB"), "iphone 17 plus");
});

test("Mercari detects iPhone 17 target text", () => {
  const normalize = extractFunction("lib/mercari-sniper.js", "normalize");
  const context = extractConstArray("lib/mercari-sniper.js", "MODEL_KEYS", { normalize });
  const detectModel = extractFunction("lib/mercari-sniper.js", "detectModel", context);
  assert.equal(detectModel("Apple iPhone 17 128GB"), "iphone 17");
});
