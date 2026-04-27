import fetch from 'node-fetch';
import chalk from 'chalk';

async function testCookieParsing() {
  // Mock response with set-cookie headers
  const mockHeaders = {
    raw: () => ({
      'set-cookie': [
        'access_token_web=abc123err; path=/; domain=.vinted.es',
        'other_cookie=xyz; path=/;'
      ]
    })
  };

  const setCookie = mockHeaders.raw()['set-cookie'] || [];
  const parts = [];
  let token = null;
  for (const entry of setCookie) {
    const pair = entry.split(';')[0];
    parts.push(pair);
    if (pair.startsWith("access_token_web=")) token = pair.slice("access_token_web=".length);
  }

  console.log("Token:", token);
  console.log("Cookie string:", parts.join("; "));

  if (token === "abc123err" && parts.includes("access_token_web=abc123err")) {
    console.log(chalk.green("Test Passed: Cookie parsing works with .raw()['set-cookie']"));
  } else {
    console.log(chalk.red("Test Failed"));
    process.exit(1);
  }
}

testCookieParsing();
