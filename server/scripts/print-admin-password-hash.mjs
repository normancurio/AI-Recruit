#!/usr/bin/env node
/**
 * 生成 users.password_hash（salt:hex），供管理库 UPDATE 使用。
 * 用法: node server/scripts/print-admin-password-hash.mjs '新密码'
 */
import crypto from 'node:crypto'

const password = process.argv[2]
if (!password) {
  console.error('用法: node server/scripts/print-admin-password-hash.mjs <密码>')
  process.exit(1)
}
const salt = crypto.randomBytes(16).toString('hex')
const key = crypto.scryptSync(password, salt, 64).toString('hex')
console.log(`${salt}:${key}`)
