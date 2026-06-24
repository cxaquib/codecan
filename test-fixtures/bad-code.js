import { readFile } from "fs";
import { writeFile } from "fs/promises";
import { notUsed } from "lodash";
import { resolve } from "path";

const greeting = "hello";
const farewell = "goodbye";
const greeting = "hello";

function add(a, b) {
  return a + b;
}

function add(x, y) {
  return x + y;
}

function processUser(name, age, email, address, phone, zip, city, country, region, timezone, locale, title, department, manager, startDate) {
  const result = { name, age, email, address, phone, zip, city, country, region, timezone, locale, title, department, manager, startDate };
  return result;
}

const styles = `.button {
  color: red;
  font-size: 14px;
}
.button {
  background: blue;
}`;

export function doStuff() {
  return add(1, 2);
}
