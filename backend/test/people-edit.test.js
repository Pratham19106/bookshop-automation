const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('only owners edit people and manage passwords within their business', async () => {
  const t = await setup();
  try {
    const created = await t.asOwner.post('/api/users', { username:'edit_person', fullName:'Before', password:'person-pass-1', role:'staff', shopIds:[t.shop1] });
    assert.equal(created.status,201,created.text);
    const id=created.body.id;
    assert.equal((await t.asStaff.put(`/api/users/${id}`,{fullName:'Denied'})).status,403);
    assert.equal((await t.asManager.post(`/api/users/${id}/password`,{newPassword:'new-pass-1'})).status,403);
    assert.equal((await t.asStaff.post('/api/auth/password',{currentPassword:'staff-pass-1',newPassword:'new-pass-1'})).status,403);
    assert.equal((await t.asOther.put(`/api/users/${id}`,{fullName:'Denied'})).status,404);
    assert.equal((await t.asOther.post(`/api/users/${id}/password`,{newPassword:'new-pass-1'})).status,404);
    const edit=await t.asOwner.put(`/api/users/${id}`,{username:'renamed_person',fullName:'After',role:'manager',shopIds:[t.shop2]});
    assert.equal(edit.status,200,edit.text);
    assert.equal(edit.body.username,'renamed_person'); assert.equal(edit.body.fullName,'After');
    assert.equal(edit.body.role,'manager'); assert.deepEqual(edit.body.shopIds,[t.shop2]);
    assert.equal((await t.asOwner.put(`/api/users/${id}`,{username:'OWNER'})).status,409);
    const loggedIn=await t.signedIn('renamed_person','person-pass-1');
    assert.equal((await t.asOwner.post(`/api/users/${id}/password`,{newPassword:'new-pass-1'})).status,200);
    assert.equal((await loggedIn.get('/api/auth/me')).status,401);
    assert.equal((await t.client().login('renamed_person','new-pass-1')).status,200);
  } finally { await t.close(); }
});
