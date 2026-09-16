'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isEnabled } = require('../src/modules/is/is-auth-server.cjs');

describe('IS feature flag (v1 deferred)', () => {
  it('defaults to disabled when env unset', () => {
    const prev = process.env.API_CONSOLE_IS_ENABLED;
    delete process.env.API_CONSOLE_IS_ENABLED;
    try {
      assert.equal(isEnabled(), false);
    } finally {
      if (prev === undefined) delete process.env.API_CONSOLE_IS_ENABLED;
      else process.env.API_CONSOLE_IS_ENABLED = prev;
    }
  });

  it('enables only when explicitly true', () => {
    const prev = process.env.API_CONSOLE_IS_ENABLED;
    process.env.API_CONSOLE_IS_ENABLED = 'true';
    try {
      assert.equal(isEnabled(), true);
    } finally {
      if (prev === undefined) delete process.env.API_CONSOLE_IS_ENABLED;
      else process.env.API_CONSOLE_IS_ENABLED = prev;
    }
  });

  it('treats false/0/off as disabled', () => {
    const prev = process.env.API_CONSOLE_IS_ENABLED;
    for (const value of ['false', '0', 'off', 'FALSE']) {
      process.env.API_CONSOLE_IS_ENABLED = value;
      assert.equal(isEnabled(), false, value);
    }
    if (prev === undefined) delete process.env.API_CONSOLE_IS_ENABLED;
    else process.env.API_CONSOLE_IS_ENABLED = prev;
  });
});
