import Util from './util.js'
import Ref from './ref.js'

export default class Render {
    constructor(viorIns) {
        this.viorInstance = viorIns
    }
    insertNode(pvlist, svnode, vnode) {
        let i = pvlist.indexOf(svnode)
        if (i >= 0)
            pvlist.splice(i + 1, 0, vnode)
        else
            pvlist.push(vnode)
    }
    runInEvalContext(__code, __ctx) {
        return eval(__code)
    }
    runInContext(vnode, key, code, evtName = null) {
        let refKeys = Object.keys(this.viorInstance.refs.__getRaw()).join(', '),
            funcKeysArr = Object.keys(this.viorInstance.funcs),
            ctxKeys = Object.keys(vnode.ctx).join(', '),
            visThis = ! evtName ? 'this.viorInstance' : 'this.__viorInstance'
        code = ! evtName ? `return (${code})` : `${code}`
        
        let funcsSetup = ''
        for (let kk in funcKeysArr) {
            let k = funcKeysArr[kk]
            funcsSetup += `let ${k} = function (...args) { __this.funcs.${k}.call(__this, ...args) }; `
        }
        let setup = `
            (function () {
                let __this = this,
                    { ${refKeys} } = this.refs,
                    { ${ctxKeys} } = __ctx;
                ${funcsSetup}
                ${code}
            }).call(${visThis})
        `
        
        if (evtName) {
            let evt = '__evt_' + evtName,
                evtSource = evt + '__source'
            vnode.ctx[evtSource] = setup
            vnode.ctx[evt] = function($this) {
                try {
                    (function (__code, __ctx) {
                        eval(__code)
                    }).call($this.__viorCtx, this[evtSource], $this.__viorCtx)
                } catch (ex) {
                    if (this.__triggerError)
                        this.__triggerError('Runtime error', key, code, ex)
                }
            }
            return `this.__viorCtx.${evt}(this)`
        } else {
            try {
                return this.runInEvalContext(setup, vnode.ctx)
            } catch (ex) {
                Util.triggerError('Render error', key, code, ex)
            }
        }
    }
    parseCommand(pvnode, vnode, ovnode, key, val, oriKey) {
        try {
            if (key == 'for') {
                let reg = /^\s*(.*?)\s+in\s+(.*?)\s*$/i,
                    matched = reg.exec(val), vars, arrCode
                if (matched)
                    ({ 1: vars, 2: arrCode } = matched)
                if (! vars || ! arrCode) {
                    vnode.deleted = true
                    return
                }
                vars = vars.replace(/[\(\)\[\]{}\s]/g, '').split(',')
                let { 0: keyName, 1: valName, 2: idName } = vars
                let arr = this.runInContext(vnode, key, arrCode)
                delete vnode.attrs[oriKey]
                
                let i = 0, lastNode = vnode
                let __doit = (k, v) => {
                    if (i == 0) {
                        if (keyName) vnode.ctx[keyName] = k
                        if (valName) vnode.ctx[valName] = v
                        if (idName) vnode.ctx[idName] = i
                    } else {
                        let nnode = Util.deepCopy(ovnode)
                        delete nnode.attrs[oriKey]
                        nnode.dom = null
                        let ctx = nnode.ctx
                        if (keyName) ctx[keyName] = k
                        if (valName) ctx[valName] = v
                        if (idName) ctx[idName] = i
                        this.insertNode(pvnode.children, lastNode, nnode)
                        lastNode = nnode
                    }
                    i ++
                }
                if (Util.isPlainObject(arr) && Util.realLength(arr)) {
                    for (let k in arr) {
                        let v = arr[k]
                        __doit(k, v)
                    }
                } else if (Ref.isRef(arr)) {
                    let ks = arr.__getKeys()
                    for (let kk in ks) {
                        let k = ks[kk],
                            v = arr[k]
                        __doit(k, v)
                    }
                }
                
                if (i == 0) {
                    vnode.deleted = true
                    return
                }
            } else if (key == 'if') {
                let res = this.runInContext(vnode, key, val)
                if (! res)
                    vnode.deleted = true
                pvnode.ctx.__if__value = res
            } else if (key == 'else') {
                let res = pvnode.ctx.__if__value
                if (res)
                    vnode.deleted = true
            } else if (key == 'elseif') {
                let res = pvnode.ctx.__if__value
                    res2 = this.runInContext(vnode, key, val)
                if (! (! res && res2))
                    vnode.deleted = true
            }
        } catch (ex) {
            Util.triggerError('Command error', oriKey, val, ex)
        }
    }
    __render(pvnode, vnode, ovnode, type, data) {
        switch (type) {
            case 'attr':
                let { key, val } = data
                let prefix = data.key.substr(0, 1),
                    newKey = data.key.substr(1), newVal
                switch (prefix) {
                    case ':':
                        newVal = this.runInContext(vnode, key, val)
                        break
                    case '@':
                        newKey = 'on' + newKey
                        newVal = this.runInContext(vnode, key, val, newKey)
                        break
                    case '$':
                        this.parseCommand(pvnode, vnode, ovnode, newKey, val, key)
                        newKey = newVal = null
                        break
                }
                return { newKey: newKey, newVal: newVal }
            case 'text':
                let reg = /{{(.*?)}}/g, res = data, matched
                while (matched = reg.exec(res)) {
                    res = res.replace(matched[0], this.runInContext(vnode, null, matched[1]))
                }
                return res
            default:
                return null
        }
    }
    render(_onode, ctx = {}, needDeepCopy = true) {
        let onode = needDeepCopy ? Util.deepCopy(_onode) : _onode
        let tree = onode.children
        let defaultCtx = {
            __viorInstance: this.viorInstance,
            __triggerError: Util.triggerError
        }
        onode.ctx = Util.deepCopy(defaultCtx, ctx)
        
        for (let k = 0; k < tree.length; k ++) {
            let v = tree[k],
                ov = Util.deepCopy(v)
            if (! v) continue
            
            v.ctx = Util.deepCopy(v.ctx || {}, onode.ctx)
            
            let deleted = false
            for (let _k2 in v.attrs) {
                let k2 = _k2,
                    v2 = v.attrs[k2]
                let { newKey, newVal } = this.__render(onode, v, ov, 'attr', { key: k2, val: v2 })
                if (v.deleted) {
                    tree.splice(k, 1)
                    k --
                    deleted = true
                    break
                }
                if (newKey && newVal)
                    v.attrs[newKey] = newVal
                if (newKey != k2)
                    delete v.attrs[k2]
            }
            if (deleted)
                continue
            
            if (v.type == 'text' && v.text)
                v.text = this.__render(onode, v, ov, 'text', v.text)
            if (v.children)
                v.children = this.render(v, v.ctx, false).children
        }
        return onode
    }
}