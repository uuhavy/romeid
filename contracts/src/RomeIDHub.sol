// SPDX-License-Identifier: MIT
pragma solidity >=0.8.26;

/// @title RomeIDHub
/// @author RomeID
/// @notice Rent-optimized unified RomeID contract implementing the complete ABI of
///         IdentityRegistry, WorkRegistry, and AttestationRegistry on Rome EVM.
contract RomeIDHub {
    fallback() external {
        assembly {
            function rev() {
                mstore(0x00, shl(224, 0xcd786059))
                revert(0x00, 0x04)
            }
            function addrMask(x) -> a {
                a := and(x, sub(shl(160, 1), 1))
            }
            function rs(ns, id) -> s {
                s := or(shl(128, ns), shl(64, id))
            }
            function hk(ns, a, b) -> s {
                mstore(0x00, ns)
                mstore(0x20, a)
                mstore(0x40, b)
                s := or(shl(255, 1), keccak256(0x00, 0x60))
            }
            function ret1(v) {
                mstore(0x00, v)
                return(0x00, 0x20)
            }
            function pushList(ns, listId, val) {
                let b := rs(ns, listId)
                let n1 := add(sload(b), 1)
                sstore(b, n1)
                sstore(add(b, n1), val)
            }
            function synth(sk) -> a {
                mstore(0x00, sk)
                a := addrMask(keccak256(0x00, 0x20))
            }
            function exists(pid) -> ok {
                ok := and(gt(pid, 0), iszero(gt(pid, sload(1))))
            }
            function isCtrl(pid, w) -> ok {
                if and(exists(pid), gt(w, 0)) {
                    ok := or(eq(sload(add(rs(2, pid), 1)), w), eq(sload(add(hk(7, pid, w), 2)), 2))
                }
            }
            function putStr(argIdx, req) -> ref {
                let pos := add(4, calldataload(add(4, shl(5, argIdx))))
                let len := calldataload(pos)
                if iszero(len) {
                    if req { rev() }
                    leave
                }
                ref := add(sload(4), 1)
                sstore(4, ref)
                let b := rs(1, ref)
                sstore(b, len)
                let words := shr(5, add(len, 31))
                for { let i := 0 } lt(i, words) { i := add(i, 1) } {
                    sstore(add(b, add(i, 1)), calldataload(add(add(pos, 32), shl(5, i))))
                }
            }
            function writeBlob(base, headIdx, tail, ref) -> nextTail {
                mstore(add(base, shl(5, headIdx)), sub(tail, base))
                if iszero(ref) {
                    mstore(tail, 0)
                    nextTail := add(tail, 32)
                    leave
                }
                let b := rs(1, ref)
                let len := sload(b)
                mstore(tail, len)
                let words := shr(5, add(len, 31))
                for { let i := 0 } lt(i, words) { i := add(i, 1) } {
                    mstore(add(add(tail, 32), shl(5, i)), sload(add(b, add(i, 1))))
                }
                nextTail := add(add(tail, 32), shl(5, words))
            }
            function writeRec(ns, id, cntSlot, nWords, blobMask, base) -> tail {
                if or(iszero(id), gt(id, sload(cntSlot))) { rev() }
                let b := rs(ns, id)
                tail := add(base, shl(5, nWords))
                for { let i := 0 } lt(i, nWords) { i := add(i, 1) } {
                    let v := sload(add(b, i))
                    switch and(shr(i, blobMask), 1)
                    case 0 { mstore(add(base, shl(5, i)), v) }
                    default { tail := writeBlob(base, i, tail, v) }
                }
            }
            function retSingleRec(ns, id, cntSlot, nWords, blobMask) {
                mstore(0x200, 0x20)
                let endPtr := writeRec(ns, id, cntSlot, nWords, blobMask, 0x220)
                return(0x200, sub(endPtr, 0x200))
            }
            function retRecList(listNs, keyId, recNs, cntSlot, nWords, blobMask) {
                let lb := rs(listNs, keyId)
                let n := sload(lb)
                mstore(0x200, 0x20)
                mstore(0x220, n)
                let arr := 0x240
                let cur := add(arr, shl(5, n))
                for { let i := 0 } lt(i, n) { i := add(i, 1) } {
                    mstore(add(arr, shl(5, i)), sub(cur, arr))
                    cur := writeRec(recNs, sload(add(lb, add(i, 1))), cntSlot, nWords, blobMask, cur)
                }
                return(0x200, sub(cur, 0x200))
            }
            function normHashCd(argIdx) -> hh {
                let pos := add(4, calldataload(add(4, shl(5, argIdx))))
                let len := calldataload(pos)
                if or(lt(len, 3), gt(len, 32)) { rev() }
                calldatacopy(0x80, add(pos, 32), len)
                for { let i := 0 } lt(i, len) { i := add(i, 1) } {
                    let ptr := add(0x80, i)
                    let b := byte(0, mload(ptr))
                    if and(gt(b, 64), lt(b, 91)) {
                        b := add(b, 32)
                        mstore8(ptr, b)
                    }
                    if iszero(or(or(lt(sub(b, 97), 26), lt(sub(b, 48), 10)), eq(b, 95))) { rev() }
                }
                hh := keccak256(0x80, len)
            }
            function createProf(sk) -> id {
                let c := caller()
                let wc := hk(4, c, 0)
                if sload(wc) { rev() }
                let sc := hk(5, sk, 0)
                if and(gt(sk, 0), gt(sload(sc), 0)) { rev() }
                let hc := hk(3, normHashCd(0), 0)
                if sload(hc) { rev() }
                id := add(sload(1), 1)
                sstore(1, id)
                let b := rs(2, id)
                sstore(b, id)
                sstore(add(b, 1), c)
                if sk {
                    sstore(add(b, 2), sk)
                    sstore(sc, id)
                }
                sstore(add(b, 3), putStr(0, 1))
                let mr := putStr(1, 0)
                if mr { sstore(add(b, 4), mr) }
                sstore(add(b, 5), timestamp())
                sstore(add(b, 6), timestamp())
                sstore(hc, id)
                sstore(wc, id)
            }

            let c := caller()
            let a0 := calldataload(4)
            let a1 := calldataload(36)
            switch shr(224, calldataload(0))
            case 0x2cb70241 { ret1(0x00fF00000000000000000000000000000000000007) }
            case 0xd2adbe79 { ret1(sload(1)) }
            case 0xc8e79b2a { ret1(sload(2)) }
            case 0x60485742 { ret1(sload(3)) }
            case 0x67819200 { ret1(sload(hk(4, addrMask(a0), 0))) }
            case 0x7ef38cd2 { ret1(exists(a0)) }
            case 0x94b1f27a { ret1(isCtrl(a0, addrMask(a1))) }
            case 0x94dba50d { ret1(synth(a0)) }
            case 0xca477db8 { ret1(sload(hk(14, a0, addrMask(a1)))) }
            case 0x8463250b {
                if iszero(a0) { ret1(0) }
                let d := sload(hk(5, a0, 0))
                if iszero(d) { d := sload(hk(4, synth(a0), 0)) }
                ret1(d)
            }
            case 0xf08f4f64 { retSingleRec(2, a0, 1, 7, 24) }
            case 0x0c16de10 { retSingleRec(2, sload(hk(3, normHashCd(0), 0)), 1, 7, 24) }
            case 0x76df4a6e { retSingleRec(9, a0, 2, 11, 56) }
            case 0x29be4db2 { retSingleRec(11, a0, 3, 9, 32) }
            case 0xed6c40fd { retRecList(10, a0, 9, 2, 11, 56) }
            case 0x32ec9fdf { retRecList(12, a0, 11, 3, 9, 32) }
            case 0x5996b87d { retRecList(13, a0, 11, 3, 9, 32) }
            case 0x04bc69a4 {
                if iszero(exists(a0)) { rev() }
                let lb := rs(6, a0)
                let n := sload(lb)
                mstore(0x200, 0x20)
                mstore(0x220, n)
                let cur := 0x240
                for { let i := 0 } lt(i, n) { i := add(i, 1) } {
                    let lk := hk(7, a0, sload(add(lb, add(i, 1))))
                    for { let j := 0 } lt(j, 6) { j := add(j, 1) } {
                        mstore(add(cur, shl(5, j)), sload(add(lk, j)))
                    }
                    cur := add(cur, 192)
                }
                return(0x200, sub(cur, 0x200))
            }
            case 0x89370d8b {
                if iszero(exists(a0)) { rev() }
                let ab := rs(16, a0)
                let ac := sload(ab)
                calldatacopy(0x200, calldatasize(), 0x80)
                if ac {
                    let rsSum := sload(add(ab, 1))
                    let da := sload(add(ab, 2))
                    let v := mul(ac, 20)
                    if gt(v, 200) { v := 200 }
                    let d := mul(da, 20)
                    if gt(d, 100) { d := 100 }
                    mstore(0x200, add(add(div(mul(rsSum, 140), ac), v), d))
                    mstore(0x220, div(mul(rsSum, 100), ac))
                    mstore(0x240, ac)
                    mstore(0x260, da)
                }
                return(0x200, 0x80)
            }
            case 0xba1feb8a { ret1(createProf(0)) }
            case 0x585fee08 {
                let sk := calldataload(68)
                if or(iszero(sk), xor(synth(sk), c)) { rev() }
                ret1(createProf(sk))
            }
            case 0x841e2fb7 {
                if iszero(isCtrl(a0, c)) { rev() }
                let b := rs(2, a0)
                sstore(add(b, 4), putStr(1, 0))
                sstore(add(b, 6), timestamp())
                stop()
            }
            case 0x8f7ea8ab {
                if iszero(isCtrl(a0, c)) { rev() }
                let other := addrMask(a1)
                let sk := calldataload(68)
                let target := other
                if and(iszero(other), gt(sk, 0)) { target := synth(sk) }
                let lk := hk(7, a0, target)
                if or(
                    or(or(iszero(target), eq(target, c)), eq(target, sload(add(rs(2, a0), 1)))),
                    or(or(gt(sload(hk(4, target, 0)), 0), and(gt(sk, 0), gt(sload(hk(5, sk, 0)), 0))), gt(sload(add(lk, 2)), 0))
                ) { rev() }
                sstore(lk, target)
                if sk { sstore(add(lk, 1), sk) }
                sstore(add(lk, 2), 1)
                sstore(add(lk, 3), c)
                sstore(add(lk, 4), timestamp())
                pushList(6, a0, target)
                stop()
            }
            case 0x870ecadd {
                let wc := hk(4, c, 0)
                if or(iszero(exists(a0)), gt(sload(wc), 0)) { rev() }
                let lk := hk(7, a0, c)
                if xor(sload(add(lk, 2)), 1) { rev() }
                let sk := sload(add(lk, 1))
                if sk {
                    let sc := hk(5, sk, 0)
                    if sload(sc) { rev() }
                    sstore(sc, a0)
                }
                sstore(add(lk, 2), 2)
                sstore(add(lk, 5), timestamp())
                sstore(wc, a0)
                sstore(add(rs(2, a0), 6), timestamp())
                stop()
            }
            case 0x60835e6e {
                let w := addrMask(a1)
                if or(iszero(exists(a0)), eq(w, sload(add(rs(2, a0), 1)))) { rev() }
                let lk := hk(7, a0, w)
                let st := sload(add(lk, 2))
                if or(iszero(st), and(xor(c, w), iszero(isCtrl(a0, c)))) { rev() }
                let sk := sload(add(lk, 1))
                if eq(st, 2) {
                    sstore(hk(4, w, 0), 0)
                    if sk { sstore(hk(5, sk, 0), 0) }
                }
                for { let j := 0 } lt(j, 6) { j := add(j, 1) } { sstore(add(lk, j), 0) }
                let lb := rs(6, a0)
                let len := sload(lb)
                for { let i := 0 } lt(i, len) { i := add(i, 1) } {
                    let curS := add(lb, add(i, 1))
                    if eq(sload(curS), w) {
                        let lastS := add(lb, len)
                        if xor(add(i, 1), len) { sstore(curS, sload(lastS)) }
                        sstore(lastS, 0)
                        sstore(lb, sub(len, 1))
                        break
                    }
                }
                stop()
            }
            case 0xb2dc8875 {
                let sd := and(calldataload(132), 0xffffffffffffffff)
                let ed := and(calldataload(164), 0xffffffffffffffff)
                if or(iszero(isCtrl(a0, c)), and(gt(ed, 0), lt(ed, sd))) { rev() }
                let id := add(sload(2), 1)
                sstore(2, id)
                let b := rs(9, id)
                sstore(b, id)
                sstore(add(b, 1), a0)
                sstore(add(b, 2), c)
                sstore(add(b, 3), putStr(1, 1))
                let dr := putStr(2, 0)
                if dr { sstore(add(b, 4), dr) }
                let ur := putStr(3, 0)
                if ur { sstore(add(b, 5), ur) }
                if sd { sstore(add(b, 6), sd) }
                if ed { sstore(add(b, 7), ed) }
                sstore(add(b, 8), timestamp())
                pushList(10, a0, id)
                ret1(id)
            }
            case 0xee3d0ee8 {
                if or(iszero(a0), gt(a0, sload(2))) { rev() }
                let b := rs(9, a0)
                if or(sload(add(b, 9)), iszero(isCtrl(sload(add(b, 1)), c))) { rev() }
                sstore(add(b, 9), 1)
                sstore(add(b, 10), timestamp())
                stop()
            }
            case 0x00968c17 {
                let rating := calldataload(68)
                if or(or(lt(rating, 1), gt(rating, 5)), or(iszero(exists(a0)), isCtrl(a0, c))) { rev() }
                if or(iszero(a1), gt(a1, sload(2))) { rev() }
                let wb := rs(9, a1)
                let actS := hk(14, a1, c)
                if or(or(xor(sload(add(wb, 1)), a0), sload(add(wb, 9))), gt(sload(actS), 0)) { rev() }
                let id := add(sload(3), 1)
                sstore(3, id)
                let b := rs(11, id)
                sstore(b, id)
                sstore(add(b, 1), a0)
                sstore(add(b, 2), a1)
                sstore(add(b, 3), c)
                sstore(add(b, 4), rating)
                let cr := putStr(3, 0)
                if cr { sstore(add(b, 5), cr) }
                sstore(add(b, 6), timestamp())
                sstore(actS, id)
                pushList(12, a0, id)
                pushList(13, a1, id)

                let cntS := hk(15, a0, c)
                let prevCnt := sload(cntS)
                sstore(cntS, add(prevCnt, 1))
                let ab := rs(16, a0)
                sstore(ab, add(sload(ab), 1))
                sstore(add(ab, 1), add(sload(add(ab, 1)), rating))
                if iszero(prevCnt) { sstore(add(ab, 2), add(sload(add(ab, 2)), 1)) }
                ret1(id)
            }
            case 0x7fbb1949 {
                if or(iszero(a0), gt(a0, sload(3))) { rev() }
                let b := rs(11, a0)
                if or(sload(add(b, 7)), xor(sload(add(b, 3)), c)) { rev() }
                let pid := sload(add(b, 1))
                let rid := sload(add(b, 2))
                sstore(add(b, 7), 1)
                sstore(add(b, 8), timestamp())
                sstore(hk(14, rid, c), 0)

                let cntS := hk(15, pid, c)
                let rem := sub(sload(cntS), 1)
                sstore(cntS, rem)
                let ab := rs(16, pid)
                sstore(ab, sub(sload(ab), 1))
                sstore(add(ab, 1), sub(sload(add(ab, 1)), sload(add(b, 4))))
                if iszero(rem) { sstore(add(ab, 2), sub(sload(add(ab, 2)), 1)) }
                stop()
            }
            default { rev() }
        }
    }
}
