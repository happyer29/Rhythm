import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfirmationController} from '../src/confirmation.js';

test('confirmation leaves the action pending until an explicit decision and defaults to cancellation', async () => {
  const controller = createConfirmationController();
  let decision;
  const result = controller.request({title: 'Discard draft?'}).then(value => { decision = value; });
  const request = controller.getSnapshot();
  await Promise.resolve();
  assert.equal(decision, undefined);
  assert.equal(request.title, 'Discard draft?');
  assert.equal(Object.isFrozen(request), true);
  controller.settle(request.id);
  await result;
  assert.equal(decision, false);
  assert.equal(controller.getSnapshot(), null);
});

test('rapid duplicate actions are canceled and stale callbacks cannot approve a later prompt', async () => {
  const controller = createConfirmationController();
  assert.equal(controller.settle(undefined, true), false);
  const first = controller.request({title: 'First action'});
  const firstId = controller.getSnapshot().id;
  assert.equal(await controller.request({title: 'Duplicate action'}), false);
  assert.equal(controller.getSnapshot().id, firstId);
  assert.equal(controller.settle(firstId, true), true);
  assert.equal(await first, true);
  const next = controller.request({title: 'A different action'});
  const nextId = controller.getSnapshot().id;
  assert.equal(controller.settle(firstId, true), false);
  assert.equal(controller.getSnapshot().id, nextId);
  controller.settle(nextId, false);
  assert.equal(await next, false);
});

test('unmount cancels outstanding decisions and remount allows a fresh prompt', async () => {
  const controller = createConfirmationController();
  const pending = controller.request({title: 'Draft action'});
  controller.dispose();
  assert.equal(await pending, false);
  assert.equal(await controller.request({title: 'After unmount'}), false);
  controller.activate();
  const reopened = controller.request({title: 'New mount'});
  controller.settle(controller.getSnapshot().id, true);
  assert.equal(await reopened, true);
});
