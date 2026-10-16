import { lua, lauxlib, lualib, to_luastring, to_jsstring } from "fengari"
import { scannerScript } from "../../server/scannerStore.ts"

// Execute the production Lua script against an in-memory Redis command surface.
export class LuaScannerStore {
  values = new Map()
  now = Date.now()
  unavailable = false
  command(command, ...args) {
    const entry = this.values.get(args[0])
    if (entry?.expires <= this.now) this.values.delete(args[0])
    const current = this.values.get(args[0])
    if (command === "GET") return current?.value ?? false
    if (command === "DEL") return this.values.delete(args[0]) ? 1 : 0
    if (command === "HGET") return current?.value[args[1]] ?? false
    if (command === "HSET") {
      const value = current?.value ?? {}
      value[args[1]] = args[2]
      this.values.set(args[0], { value, expires: current?.expires ?? Infinity })
      return 1
    }
    if (command === "EXPIRE") {
      if (current) current.expires = this.now + Number(args[1]) * 1000
      return current ? 1 : 0
    }
    if (command === "INCR") {
      const value = Number(current?.value ?? 0) + 1
      this.values.set(args[0], {
        value: String(value),
        expires: current?.expires ?? Infinity,
      })
      return value
    }
    if (command === "SET") {
      if (args.includes("NX") && current) return false
      const index = args.indexOf("EX")
      this.values.set(args[0], {
        value: args[1],
        expires:
          index >= 0
            ? this.now + Number(args[index + 1]) * 1000
            : args.includes("KEEPTTL")
              ? (current?.expires ?? Infinity)
              : Infinity,
      })
      return "OK"
    }
    throw Error("Unexpected Redis command: " + command)
  }
  async run(id, operation, input) {
    if (this.unavailable) throw Error("Redis unavailable")
    this.now = input.now
    const L = lauxlib.luaL_newstate()
    lualib.luaL_openlibs(L)
    const nullPointer = {}
    function push(value) {
      if (value === null || value === undefined)
        lua.lua_pushlightuserdata(L, nullPointer)
      else if (typeof value === "string")
        lua.lua_pushstring(L, to_luastring(value))
      else if (typeof value === "number") lua.lua_pushnumber(L, value)
      else if (typeof value === "boolean") lua.lua_pushboolean(L, value)
      else {
        lua.lua_newtable(L)
        for (const [key, item] of Object.entries(value)) {
          if (Array.isArray(value)) lua.lua_pushinteger(L, Number(key) + 1)
          else lua.lua_pushstring(L, to_luastring(key))
          push(item)
          lua.lua_settable(L, -3)
        }
      }
    }
    function read(index) {
      const type = lua.lua_type(L, index)
      if (type === lua.LUA_TNIL || type === lua.LUA_TLIGHTUSERDATA) return null
      if (type === lua.LUA_TBOOLEAN) return !!lua.lua_toboolean(L, index)
      if (type === lua.LUA_TNUMBER) return lua.lua_tonumber(L, index)
      if (type === lua.LUA_TSTRING)
        return to_jsstring(lua.lua_tolstring(L, index))
      if (type === lua.LUA_TTABLE) {
        const absolute = lua.lua_absindex(L, index),
          result = {}
        let numeric = true
        let count = 0
        lua.lua_pushnil(L)
        while (lua.lua_next(L, absolute)) {
          const key = read(-2)
          result[key] = read(-1)
          numeric &&= typeof key === "number"
          count++
          lua.lua_pop(L, 1)
        }
        return numeric && count > 0
          ? Object.keys(result)
              .sort((a, b) => a - b)
              .map((key) => result[key])
          : result
      }
      throw Error("Unexpected Lua type")
    }
    function fn(callback) {
      lua.lua_pushcfunction(L, (state) => {
        try {
          const args = Array.from({ length: lua.lua_gettop(state) }, (_, i) =>
            read(i + 1),
          )
          push(callback(...args))
          return 1
        } catch (error) {
          return lauxlib.luaL_error(state, to_luastring(error.message))
        }
      })
    }
    push(["scanner:" + id, "limit:" + input.client, "receipts:" + id])
    lua.lua_setglobal(L, to_luastring("KEYS"))
    push([operation, JSON.stringify(input)])
    lua.lua_setglobal(L, to_luastring("ARGV"))
    lua.lua_newtable(L)
    fn((...args) => this.command(...args))
    lua.lua_setfield(L, -2, to_luastring("call"))
    lua.lua_setglobal(L, to_luastring("redis"))
    lua.lua_newtable(L)
    fn((value) => JSON.parse(value))
    lua.lua_setfield(L, -2, to_luastring("decode"))
    fn((value) => JSON.stringify(value))
    lua.lua_setfield(L, -2, to_luastring("encode"))
    push(null)
    lua.lua_setfield(L, -2, to_luastring("null"))
    lua.lua_setglobal(L, to_luastring("cjson"))
    try {
      if (
        lauxlib.luaL_loadstring(L, to_luastring(scannerScript)) !==
          lua.LUA_OK ||
        lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK
      )
        throw Error(to_jsstring(lua.lua_tolstring(L, -1)))
      return JSON.parse(read(-1))
    } finally {
      lua.lua_close(L)
    }
  }
}
