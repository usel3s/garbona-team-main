"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { formatPanelError } = require("../src/services/apiService");

test("formatPanelError prefers UProject error field over axios status text", () => {
  const error = {
    message: "Request failed with status code 409",
    response: { status: 409, data: { error: "Path already exists" } },
  };
  assert.equal(formatPanelError(error), "Path already exists");
});

test("formatPanelError reads message field", () => {
  const error = {
    message: "Request failed with status code 400",
    response: { status: 400, data: { message: "Invalid template" } },
  };
  assert.equal(formatPanelError(error), "Invalid template");
});

test("formatPanelError maps bare 409 axios text to a path conflict", () => {
  const error = {
    message: "Request failed with status code 409",
    response: { status: 409, data: {} },
  };
  assert.match(formatPanelError(error), /уже занят/i);
});
