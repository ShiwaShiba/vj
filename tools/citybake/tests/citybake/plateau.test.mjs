import assert from 'node:assert';
import { test } from 'node:test';
import { parse } from '../../vendor/txml.mjs';

test('vendored txml parses a namespaced element tree', () => {
  const tree = parse('<a:Root xmlns:a="x"><a:Kid v="1">hi</a:Kid></a:Root>');
  const root = tree.find((n) => n && n.tagName === 'a:Root');
  assert.ok(root, 'root found');
  const kid = root.children.find((n) => n && n.tagName === 'a:Kid');
  assert.strictEqual(kid.attributes.v, '1');
  assert.strictEqual(kid.children[0], 'hi');
});
