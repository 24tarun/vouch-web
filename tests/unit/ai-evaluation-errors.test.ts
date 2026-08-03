import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAiEvaluationError } from '@/lib/ai-voucher/errors';

test('AI evaluation errors preserve Error messages', () => {
    assert.equal(describeAiEvaluationError(new Error('Gemini timed out')), 'Gemini timed out');
});

test('AI evaluation errors preserve PostgREST object messages', () => {
    assert.equal(
        describeAiEvaluationError({ code: '42702', message: 'column reference is ambiguous' }),
        'column reference is ambiguous',
    );
});

test('AI evaluation errors serialize structured objects instead of object Object', () => {
    assert.equal(describeAiEvaluationError({ code: 'P0001' }), '{"code":"P0001"}');
});
