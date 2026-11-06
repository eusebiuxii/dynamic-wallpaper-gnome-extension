// SPDX-License-Identifier: GPL-2.0-or-later
// A tiny test runner, so the tests need nothing but `gjs` to run.
// Usage in a test file:  test('name', () => { assertEqual(a, b); });

const results = {passed: 0, failed: 0};

export function test(name, fn) {
    try {
        fn();
        results.passed++;
        print(`  ✓ ${name}`);
    } catch (e) {
        results.failed++;
        print(`  ✗ ${name}\n      ${e.message}`);
    }
}

export function assert(condition, message = 'assertion failed') {
    if (!condition)
        throw new Error(message);
}

export function assertEqual(actual, expected, message = '') {
    if (actual !== expected)
        throw new Error(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`.trim());
}

/** Passes if two Dates are within `minutes` of each other. */
export function assertNear(actual, expected, minutes, message = '') {
    const diff = Math.abs(actual - expected) / 60_000;
    if (!(diff <= minutes))
        throw new Error(`${message} ${actual?.toString()} is ${diff.toFixed(1)} min from ${expected.toString()}`.trim());
}

export function summary() {
    print(`\n${results.passed} passed, ${results.failed} failed`);
    return results.failed === 0;
}
