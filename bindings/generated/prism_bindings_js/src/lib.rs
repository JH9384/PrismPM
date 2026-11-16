#![forbid(unsafe_code)]
use core::cmp::Ordering;

use core::sync::atomic::{AtomicU64, Ordering as Memory};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Overflow;

pub type R<T> = Result<T, Overflow>;

static WORK: AtomicU64 = AtomicU64::new(0);

pub fn tick(units: u64) { WORK.fetch_add(units, Memory::Relaxed); }

pub fn work() -> u64 { WORK.load(Memory::Relaxed) }

pub trait Same {
    fn same(&self, other: &Self) -> bool;
}

pub trait Key {
    fn key(&self, other: &Self) -> Ordering;
}

impl Same for bool {
    fn same(&self, other: &Self) -> bool { self == other }
}

impl Key for bool {
    fn key(&self, other: &Self) -> Ordering { self.cmp(other) }
}

impl Same for u8 {
    fn same(&self, other: &Self) -> bool { self == other }
}

impl Key for u8 {
    fn key(&self, other: &Self) -> Ordering { self.cmp(other) }
}

impl Same for u16 {
    fn same(&self, other: &Self) -> bool { self == other }
}

impl Key for u16 {
    fn key(&self, other: &Self) -> Ordering { self.cmp(other) }
}

impl Same for u32 {
    fn same(&self, other: &Self) -> bool { self == other }
}

impl Key for u32 {
    fn key(&self, other: &Self) -> Ordering { self.cmp(other) }
}

impl Same for u64 {
    fn same(&self, other: &Self) -> bool { self == other }
}

impl Key for u64 {
    fn key(&self, other: &Self) -> Ordering { self.cmp(other) }
}

impl Same for i8 {
    fn same(&self, other: &Self) -> bool { self == other }
}

impl Key for i8 {
    fn key(&self, other: &Self) -> Ordering { self.cmp(other) }
}

impl Same for i16 {
    fn same(&self, other: &Self) -> bool { self == other }
}

impl Key for i16 {
    fn key(&self, other: &Self) -> Ordering { self.cmp(other) }
}

impl Same for i32 {
    fn same(&self, other: &Self) -> bool { self == other }
}

impl Key for i32 {
    fn key(&self, other: &Self) -> Ordering { self.cmp(other) }
}

impl Same for i64 {
    fn same(&self, other: &Self) -> bool { self == other }
}

impl Key for i64 {
    fn key(&self, other: &Self) -> Ordering { self.cmp(other) }
}

impl Same for Ordering {
    fn same(&self, other: &Self) -> bool { self == other }
}

impl<A: Key, B: Key> Key for (A, B) {
    fn key(&self, other: &Self) -> Ordering { match self.0.key(&other.0) { Ordering::Equal => self.1.key(&other.1), decided => decided, } }
}

pub fn equal<T: Same>(a: T, b: T) -> bool { a.same(&b) }

pub fn compare<T: Key>(a: T, b: T) -> Ordering { a.key(&b) }

pub fn nat_add(p0: u64, p1: u64) -> R<u64> {
    match u64::checked_add(p0, p1) {
        Some(v0) => {
            Ok(v0)
        }
        None => {
            Err::<u64, Overflow>(Overflow)
        }
    }
}

pub fn nat_sub(p0: u64, p1: u64) -> u64 {
    u64::saturating_sub(p0, p1)
}

pub fn nat_mul(p0: u64, p1: u64) -> R<u64> {
    match u64::checked_mul(p0, p1) {
        Some(v0) => {
            Ok(v0)
        }
        None => {
            Err::<u64, Overflow>(Overflow)
        }
    }
}

pub fn nat_quot(p0: u64, p1: u64, p2: u64) -> u64 {
    u64::checked_div(p0, p1).unwrap_or(p2)
}

pub fn nat_rem(p0: u64, p1: u64, p2: u64) -> u64 {
    u64::checked_rem(p0, p1).unwrap_or(p2)
}

pub fn nat_eq(p0: u64, p1: u64) -> bool {
    core::cmp::PartialEq::eq(&p0, &p1)
}

pub fn nat_le(p0: u64, p1: u64) -> bool {
    core::cmp::PartialOrd::le(&p0, &p1)
}

pub fn nat_lt(p0: u64, p1: u64) -> bool {
    core::cmp::PartialOrd::lt(&p0, &p1)
}

pub fn nat_succ(p0: u64) -> R<u64> {
    match u64::checked_add(p0, 1u64) {
        Some(v0) => {
            Ok(v0)
        }
        None => {
            Err::<u64, Overflow>(Overflow)
        }
    }
}

pub fn int_add(p0: i64, p1: i64) -> R<i64> {
    match i64::checked_add(p0, p1) {
        Some(v0) => {
            Ok(v0)
        }
        None => {
            Err::<i64, Overflow>(Overflow)
        }
    }
}

pub fn int_sub(p0: i64, p1: i64) -> R<i64> {
    match i64::checked_sub(p0, p1) {
        Some(v0) => {
            Ok(v0)
        }
        None => {
            Err::<i64, Overflow>(Overflow)
        }
    }
}

pub fn int_mul(p0: i64, p1: i64) -> R<i64> {
    match i64::checked_mul(p0, p1) {
        Some(v0) => {
            Ok(v0)
        }
        None => {
            Err::<i64, Overflow>(Overflow)
        }
    }
}

pub fn int_neg(p0: i64) -> R<i64> {
    match i64::checked_neg(p0) {
        Some(v0) => {
            Ok(v0)
        }
        None => {
            Err::<i64, Overflow>(Overflow)
        }
    }
}

pub fn int_quot(p0: i64, p1: i64, p2: i64) -> R<i64> {
    { let value = { let (a, b, z): (i64, i64, i64) = (p0, p1, p2); if b == 0 { Some(z) } else { a.checked_div(b) } }; match value {
        Some(v0) => {
            Ok(v0)
        }
        None => {
            Err::<i64, Overflow>(Overflow)
        }
    } }
}

pub fn int_rem(p0: i64, p1: i64, p2: i64) -> i64 {
    { let (a, b, z): (i64, i64, i64) = (p0, p1, p2); if b == 0 { z } else { a.wrapping_rem(b) } }
}

pub fn bool_not(p0: bool) -> bool {
    !p0
}

pub fn bool_and(p0: bool, p1: bool) -> bool {
    if p0 {
        p1
    } else {
        false
    }
}

pub fn bool_or(p0: bool, p1: bool) -> bool {
    if p0 {
        true
    } else {
        p1
    }
}

pub mod fixed_u8 {
    pub fn checked_add(p0: u8, p1: u8) -> Option<u8> {
        u8::checked_add(p0, p1)
    }

    pub fn checked_sub(p0: u8, p1: u8) -> Option<u8> {
        u8::checked_sub(p0, p1)
    }

    pub fn checked_mul(p0: u8, p1: u8) -> Option<u8> {
        u8::checked_mul(p0, p1)
    }

    pub fn checked_quot(p0: u8, p1: u8) -> Option<u8> {
        u8::checked_div(p0, p1)
    }

    pub fn bit_and(p0: u8, p1: u8) -> u8 {
        core::ops::BitAnd::bitand(p0, p1)
    }

    pub fn bit_or(p0: u8, p1: u8) -> u8 {
        core::ops::BitOr::bitor(p0, p1)
    }

    pub fn bit_xor(p0: u8, p1: u8) -> u8 {
        core::ops::BitXor::bitxor(p0, p1)
    }

    pub fn bit_not(p0: u8) -> u8 {
        core::ops::Not::not(p0)
    }

    pub fn shift_left(p0: u8, p1: u32) -> Option<u8> {
        u8::checked_shl(p0, p1)
    }

    pub fn shift_right(p0: u8, p1: u32) -> Option<u8> {
        u8::checked_shr(p0, p1)
    }

    pub fn convert(p0: i128) -> Option<u8> {
        u8::try_from(p0).ok()
    }
}

pub mod fixed_u16 {
    pub fn checked_add(p0: u16, p1: u16) -> Option<u16> {
        u16::checked_add(p0, p1)
    }

    pub fn checked_sub(p0: u16, p1: u16) -> Option<u16> {
        u16::checked_sub(p0, p1)
    }

    pub fn checked_mul(p0: u16, p1: u16) -> Option<u16> {
        u16::checked_mul(p0, p1)
    }

    pub fn checked_quot(p0: u16, p1: u16) -> Option<u16> {
        u16::checked_div(p0, p1)
    }

    pub fn bit_and(p0: u16, p1: u16) -> u16 {
        core::ops::BitAnd::bitand(p0, p1)
    }

    pub fn bit_or(p0: u16, p1: u16) -> u16 {
        core::ops::BitOr::bitor(p0, p1)
    }

    pub fn bit_xor(p0: u16, p1: u16) -> u16 {
        core::ops::BitXor::bitxor(p0, p1)
    }

    pub fn bit_not(p0: u16) -> u16 {
        core::ops::Not::not(p0)
    }

    pub fn shift_left(p0: u16, p1: u32) -> Option<u16> {
        u16::checked_shl(p0, p1)
    }

    pub fn shift_right(p0: u16, p1: u32) -> Option<u16> {
        u16::checked_shr(p0, p1)
    }

    pub fn convert(p0: i128) -> Option<u16> {
        u16::try_from(p0).ok()
    }
}

pub mod fixed_u32 {
    pub fn checked_add(p0: u32, p1: u32) -> Option<u32> {
        u32::checked_add(p0, p1)
    }

    pub fn checked_sub(p0: u32, p1: u32) -> Option<u32> {
        u32::checked_sub(p0, p1)
    }

    pub fn checked_mul(p0: u32, p1: u32) -> Option<u32> {
        u32::checked_mul(p0, p1)
    }

    pub fn checked_quot(p0: u32, p1: u32) -> Option<u32> {
        u32::checked_div(p0, p1)
    }

    pub fn bit_and(p0: u32, p1: u32) -> u32 {
        core::ops::BitAnd::bitand(p0, p1)
    }

    pub fn bit_or(p0: u32, p1: u32) -> u32 {
        core::ops::BitOr::bitor(p0, p1)
    }

    pub fn bit_xor(p0: u32, p1: u32) -> u32 {
        core::ops::BitXor::bitxor(p0, p1)
    }

    pub fn bit_not(p0: u32) -> u32 {
        core::ops::Not::not(p0)
    }

    pub fn shift_left(p0: u32, p1: u32) -> Option<u32> {
        u32::checked_shl(p0, p1)
    }

    pub fn shift_right(p0: u32, p1: u32) -> Option<u32> {
        u32::checked_shr(p0, p1)
    }

    pub fn convert(p0: i128) -> Option<u32> {
        u32::try_from(p0).ok()
    }
}

pub mod fixed_u64 {
    pub fn checked_add(p0: u64, p1: u64) -> Option<u64> {
        u64::checked_add(p0, p1)
    }

    pub fn checked_sub(p0: u64, p1: u64) -> Option<u64> {
        u64::checked_sub(p0, p1)
    }

    pub fn checked_mul(p0: u64, p1: u64) -> Option<u64> {
        u64::checked_mul(p0, p1)
    }

    pub fn checked_quot(p0: u64, p1: u64) -> Option<u64> {
        u64::checked_div(p0, p1)
    }

    pub fn bit_and(p0: u64, p1: u64) -> u64 {
        core::ops::BitAnd::bitand(p0, p1)
    }

    pub fn bit_or(p0: u64, p1: u64) -> u64 {
        core::ops::BitOr::bitor(p0, p1)
    }

    pub fn bit_xor(p0: u64, p1: u64) -> u64 {
        core::ops::BitXor::bitxor(p0, p1)
    }

    pub fn bit_not(p0: u64) -> u64 {
        core::ops::Not::not(p0)
    }

    pub fn shift_left(p0: u64, p1: u32) -> Option<u64> {
        u64::checked_shl(p0, p1)
    }

    pub fn shift_right(p0: u64, p1: u32) -> Option<u64> {
        u64::checked_shr(p0, p1)
    }

    pub fn convert(p0: i128) -> Option<u64> {
        u64::try_from(p0).ok()
    }
}

pub mod fixed_i8 {
    pub fn checked_add(p0: i8, p1: i8) -> Option<i8> {
        i8::checked_add(p0, p1)
    }

    pub fn checked_sub(p0: i8, p1: i8) -> Option<i8> {
        i8::checked_sub(p0, p1)
    }

    pub fn checked_mul(p0: i8, p1: i8) -> Option<i8> {
        i8::checked_mul(p0, p1)
    }

    pub fn checked_quot(p0: i8, p1: i8) -> Option<i8> {
        i8::checked_div(p0, p1)
    }

    pub fn bit_and(p0: i8, p1: i8) -> i8 {
        core::ops::BitAnd::bitand(p0, p1)
    }

    pub fn bit_or(p0: i8, p1: i8) -> i8 {
        core::ops::BitOr::bitor(p0, p1)
    }

    pub fn bit_xor(p0: i8, p1: i8) -> i8 {
        core::ops::BitXor::bitxor(p0, p1)
    }

    pub fn bit_not(p0: i8) -> i8 {
        core::ops::Not::not(p0)
    }

    pub fn shift_left(p0: i8, p1: u32) -> Option<i8> {
        i8::checked_shl(p0, p1)
    }

    pub fn shift_right(p0: i8, p1: u32) -> Option<i8> {
        i8::checked_shr(p0, p1)
    }

    pub fn convert(p0: i128) -> Option<i8> {
        i8::try_from(p0).ok()
    }
}

pub fn checked_neg_i8(p0: i8) -> Option<i8> {
    i8::checked_neg(p0)
}

pub mod fixed_i16 {
    pub fn checked_add(p0: i16, p1: i16) -> Option<i16> {
        i16::checked_add(p0, p1)
    }

    pub fn checked_sub(p0: i16, p1: i16) -> Option<i16> {
        i16::checked_sub(p0, p1)
    }

    pub fn checked_mul(p0: i16, p1: i16) -> Option<i16> {
        i16::checked_mul(p0, p1)
    }

    pub fn checked_quot(p0: i16, p1: i16) -> Option<i16> {
        i16::checked_div(p0, p1)
    }

    pub fn bit_and(p0: i16, p1: i16) -> i16 {
        core::ops::BitAnd::bitand(p0, p1)
    }

    pub fn bit_or(p0: i16, p1: i16) -> i16 {
        core::ops::BitOr::bitor(p0, p1)
    }

    pub fn bit_xor(p0: i16, p1: i16) -> i16 {
        core::ops::BitXor::bitxor(p0, p1)
    }

    pub fn bit_not(p0: i16) -> i16 {
        core::ops::Not::not(p0)
    }

    pub fn shift_left(p0: i16, p1: u32) -> Option<i16> {
        i16::checked_shl(p0, p1)
    }

    pub fn shift_right(p0: i16, p1: u32) -> Option<i16> {
        i16::checked_shr(p0, p1)
    }

    pub fn convert(p0: i128) -> Option<i16> {
        i16::try_from(p0).ok()
    }
}

pub fn checked_neg_i16(p0: i16) -> Option<i16> {
    i16::checked_neg(p0)
}

pub mod fixed_i32 {
    pub fn checked_add(p0: i32, p1: i32) -> Option<i32> {
        i32::checked_add(p0, p1)
    }

    pub fn checked_sub(p0: i32, p1: i32) -> Option<i32> {
        i32::checked_sub(p0, p1)
    }

    pub fn checked_mul(p0: i32, p1: i32) -> Option<i32> {
        i32::checked_mul(p0, p1)
    }

    pub fn checked_quot(p0: i32, p1: i32) -> Option<i32> {
        i32::checked_div(p0, p1)
    }

    pub fn bit_and(p0: i32, p1: i32) -> i32 {
        core::ops::BitAnd::bitand(p0, p1)
    }

    pub fn bit_or(p0: i32, p1: i32) -> i32 {
        core::ops::BitOr::bitor(p0, p1)
    }

    pub fn bit_xor(p0: i32, p1: i32) -> i32 {
        core::ops::BitXor::bitxor(p0, p1)
    }

    pub fn bit_not(p0: i32) -> i32 {
        core::ops::Not::not(p0)
    }

    pub fn shift_left(p0: i32, p1: u32) -> Option<i32> {
        i32::checked_shl(p0, p1)
    }

    pub fn shift_right(p0: i32, p1: u32) -> Option<i32> {
        i32::checked_shr(p0, p1)
    }

    pub fn convert(p0: i128) -> Option<i32> {
        i32::try_from(p0).ok()
    }
}

pub fn checked_neg_i32(p0: i32) -> Option<i32> {
    i32::checked_neg(p0)
}

pub mod fixed_i64 {
    pub fn checked_add(p0: i64, p1: i64) -> Option<i64> {
        i64::checked_add(p0, p1)
    }

    pub fn checked_sub(p0: i64, p1: i64) -> Option<i64> {
        i64::checked_sub(p0, p1)
    }

    pub fn checked_mul(p0: i64, p1: i64) -> Option<i64> {
        i64::checked_mul(p0, p1)
    }

    pub fn checked_quot(p0: i64, p1: i64) -> Option<i64> {
        i64::checked_div(p0, p1)
    }

    pub fn bit_and(p0: i64, p1: i64) -> i64 {
        core::ops::BitAnd::bitand(p0, p1)
    }

    pub fn bit_or(p0: i64, p1: i64) -> i64 {
        core::ops::BitOr::bitor(p0, p1)
    }

    pub fn bit_xor(p0: i64, p1: i64) -> i64 {
        core::ops::BitXor::bitxor(p0, p1)
    }

    pub fn bit_not(p0: i64) -> i64 {
        core::ops::Not::not(p0)
    }

    pub fn shift_left(p0: i64, p1: u32) -> Option<i64> {
        i64::checked_shl(p0, p1)
    }

    pub fn shift_right(p0: i64, p1: u32) -> Option<i64> {
        i64::checked_shr(p0, p1)
    }

    pub fn convert(p0: i128) -> Option<i64> {
        i64::try_from(p0).ok()
    }
}

pub fn checked_neg_i64(p0: i64) -> Option<i64> {
    i64::checked_neg(p0)
}
use core::str;

use std::mem;

use std::rc::Rc;

#[derive(Clone)]
pub struct Str(Rc<str>);

impl Str {
    pub fn lit(text: &str) -> Str { Str(Rc::from(text)) }
    pub fn text(&self) -> &str { &self.0 }
    pub fn length(&self) -> u64 { chars(&self.0) }
    pub fn utf8_encode(&self) -> Bytes { tick(self.0.len() as u64); Bytes::lit(self.0.as_bytes()) }
    pub fn split_exact(&self, delimiter: &Str, maximum: u32) -> Option<List<Str>> { if delimiter.0.is_empty() { return None; }; chars(&self.0); let mut fields: Vec<Str> = Vec::new(); for piece in self.0.split(&*delimiter.0) { fields.push(Str::lit(piece)); }; if fields.len() as u128 > u128::from(maximum) { return None; }; Some(List::onto(fields, List::nil())) }
    pub fn join(texts: List<Str>, delimiter: &Str) -> Str { let mut out = String::new(); let mut first = true; let mut cursor = &texts; while let Repr::Cell(cell) = &cursor.0 { tick(1); if !first { chars(&delimiter.0); out.push_str(&delimiter.0); }; first = false; chars(&cell.head.0); out.push_str(&cell.head.0); cursor = &cell.tail; }; match &cursor.0 { Repr::Run { buffer, len } => { for text in buffer[..*len].iter().rev() { tick(1); if !first { chars(&delimiter.0); out.push_str(&delimiter.0); }; first = false; chars(&text.0); out.push_str(&text.0); } }, _ => { }, }; Str::lit(&out) }
}

#[derive(Clone)]
pub struct Bytes(Rc<[u8]>);

impl Bytes {
    pub fn lit(octets: &[u8]) -> Bytes { Bytes(Rc::from(octets)) }
    pub fn octets(&self) -> &[u8] { &self.0 }
    pub fn append(a: Bytes, b: Bytes) -> Bytes { tick((a.0.len() + b.0.len()) as u64); let mut out = Vec::with_capacity(a.0.len() + b.0.len()); out.extend_from_slice(&a.0); out.extend_from_slice(&b.0); Bytes(Rc::from(out)) }
    pub fn length(&self) -> u64 { self.0.len() as u64 }
    pub fn index(&self, i: u64) -> Option<u8> { match usize::try_from(i) { Ok(at) => self.0.get(at).copied(), Err(_) => None, } }
    pub fn slice(&self, start: u64, count: u64) -> Option<Bytes> { let end = u128::from(start) + u128::from(count); if end > self.0.len() as u128 { return None; }; tick(count); Some(Bytes::lit(&self.0[start as usize..end as usize])) }
    pub fn utf8_decode(&self) -> Option<Str> { tick(self.0.len() as u64); match str::from_utf8(&self.0) { Ok(text) => Some(Str::lit(text)), Err(_) => None, } }
    pub fn compare(&self, other: &Bytes) -> Ordering { tick(1 + self.0.len().min(other.0.len()) as u64); self.0.cmp(&other.0) }
}

pub struct Node<T> { head: T, tail: List<T> }

pub enum Repr<T> { Nil, Run { buffer: Rc<Vec<T>>, len: usize }, Cell(Rc<Node<T>>) }

pub struct List<T>(Repr<T>);

impl<T> Clone for List<T> {
    fn clone(&self) -> Self { List(match &self.0 { Repr::Nil => Repr::Nil, Repr::Run { buffer, len } => Repr::Run { buffer: buffer.clone(), len: *len }, Repr::Cell(cell) => Repr::Cell(cell.clone()), }) }
}

impl<T> List<T> {
    fn take(&mut self) -> Repr<T> { mem::replace(&mut self.0, Repr::Nil) }
}

impl<T> Drop for Node<T> {
    fn drop(&mut self) { let mut next = match self.tail.take() { Repr::Cell(cell) => Some(cell), _ => None, }; while let Some(cell) = next { match Rc::try_unwrap(cell) { Ok(mut node) => next = match node.tail.take() { Repr::Cell(cell) => Some(cell), _ => None, }, Err(_) => break, } } }
}

impl<T: Clone> List<T> {
    pub fn nil() -> Self { List(Repr::Nil) }
    pub fn cons(head: T, mut tail: List<T>) -> Self { List(match tail.take() { Repr::Nil => { let mut buffer = Vec::with_capacity(16); buffer.push(head); Repr::Run { buffer: Rc::new(buffer), len: 1 } }, Repr::Run { mut buffer, len } => { match Rc::get_mut(&mut buffer) { Some(cells) => { cells.truncate(len); cells.push(head); Repr::Run { buffer, len: len + 1 } }, None => Repr::Cell(Rc::new(Node { head, tail: List(Repr::Run { buffer, len }) })), } }, rest => Repr::Cell(Rc::new(Node { head, tail: List(rest) })), }) }
    pub fn uncons(&self) -> Option<(T, List<T>)> { match &self.0 { Repr::Nil => None, Repr::Run { buffer, len } => { let head = buffer[len - 1].clone(); Some((head, List(if *len == 1 { Repr::Nil } else { Repr::Run { buffer: buffer.clone(), len: len - 1 } }))) }, Repr::Cell(cell) => Some((cell.head.clone(), cell.tail.clone())), } }
    pub fn length(&self) -> u64 { let mut count = 0; let mut cursor = self; while let Repr::Cell(cell) = &cursor.0 { tick(1); count += 1; cursor = &cell.tail; }; match &cursor.0 { Repr::Run { buffer, len } => { for _ in buffer[..*len].iter().rev() { tick(1); count += 1; } }, _ => { }, }; count }
    pub fn append(a: List<T>, b: List<T>) -> List<T> { List::onto(a.items(), b) }
    pub fn index(&self, i: u64) -> Option<T> { let mut position = 0; let mut cursor = self; while let Repr::Cell(cell) = &cursor.0 { tick(1); if position == i { return Some(cell.head.clone()); }; position += 1; cursor = &cell.tail; }; match &cursor.0 { Repr::Run { buffer, len } => { for item in buffer[..*len].iter().rev() { tick(1); if position == i { return Some(item.clone()); }; position += 1; } }, _ => { }, }; None }
    pub fn slice(&self, start: u64, count: u64) -> Option<List<T>> { let end = u128::from(start) + u128::from(count); let mut part = Vec::new(); let mut position: u128 = 0; let mut cursor = self; while let Repr::Cell(cell) = &cursor.0 { tick(1); if position >= end { return Some(List::onto(part, List::nil())); }; if position >= u128::from(start) { part.push(cell.head.clone()); }; position += 1; cursor = &cell.tail; }; match &cursor.0 { Repr::Run { buffer, len } => { for item in buffer[..*len].iter().rev() { tick(1); if position >= end { return Some(List::onto(part, List::nil())); }; if position >= u128::from(start) { part.push(item.clone()); }; position += 1; } }, _ => { }, }; if position < end { None } else { Some(List::onto(part, List::nil())) } }
    fn items(&self) -> Vec<T> { let mut out = Vec::new(); let mut cursor = self; while let Repr::Cell(cell) = &cursor.0 { tick(1); out.push(cell.head.clone()); cursor = &cell.tail; }; match &cursor.0 { Repr::Run { buffer, len } => { for item in buffer[..*len].iter().rev() { tick(1); out.push(item.clone()); } }, _ => { }, }; out }
    fn onto(mut items: Vec<T>, tail: List<T>) -> List<T> { let mut out = tail; while let Some(item) = items.pop() { tick(1); out = List::cons(item, out); }; out }
}

pub fn chars(text: &str) -> u64 { let mut count = 0; for _ in text.chars() { tick(1); count += 1; }; count }

impl Same for Str {
    fn same(&self, other: &Self) -> bool { let mut left = self.0.chars(); let mut right = other.0.chars(); loop { tick(1); match (left.next(), right.next()) { (None, None) => return true, (a, b) if a != b => return false, _ => { }, } } }
}

impl Same for Bytes {
    fn same(&self, other: &Self) -> bool { tick(1 + self.0.len().min(other.0.len()) as u64); self.0 == other.0 }
}

impl Key for Str {
    fn key(&self, other: &Self) -> Ordering { let mut left = self.0.chars(); let mut right = other.0.chars(); loop { tick(1); match (left.next(), right.next()) { (None, None) => return Ordering::Equal, (None, Some(_)) => return Ordering::Less, (Some(_), None) => return Ordering::Greater, (Some(a), Some(b)) => match a.cmp(&b) { Ordering::Equal => { }, decided => return decided, }, } } }
}

pub fn canonical_decimal(text: &str) -> Option<Option<i128>> { let digits = match text.strip_prefix('-') { Some(rest) => rest, None => text, }; let mut canonical = !digits.is_empty() && (digits == "0" || !digits.starts_with('0')) && text != "-0"; for c in digits.chars() { tick(1); canonical = canonical && c.is_ascii_digit(); }; if !canonical { return None; }; Some(text.parse::<i128>().ok()) }

pub fn parse_int(text: Str) -> R<Option<i64>> { match canonical_decimal(&text.0) { None => Ok(None), Some(Some(n)) => match i64::try_from(n) { Ok(value) => Ok(Some(value)), Err(_) => Err(Overflow), }, Some(None) => Err(Overflow), } }

pub fn format_u8(a: u8) -> Str { let text = a.to_string(); tick(text.len() as u64); Str::lit(&text) }

pub fn parse_u8(text: Str) -> Option<u8> { match canonical_decimal(&text.0) { Some(Some(n)) => u8::try_from(n).ok(), _ => None, } }

pub fn format_u16(a: u16) -> Str { let text = a.to_string(); tick(text.len() as u64); Str::lit(&text) }

pub fn parse_u16(text: Str) -> Option<u16> { match canonical_decimal(&text.0) { Some(Some(n)) => u16::try_from(n).ok(), _ => None, } }

pub fn format_u32(a: u32) -> Str { let text = a.to_string(); tick(text.len() as u64); Str::lit(&text) }

pub fn parse_u32(text: Str) -> Option<u32> { match canonical_decimal(&text.0) { Some(Some(n)) => u32::try_from(n).ok(), _ => None, } }

pub fn format_u64(a: u64) -> Str { let text = a.to_string(); tick(text.len() as u64); Str::lit(&text) }

pub fn parse_u64(text: Str) -> Option<u64> { match canonical_decimal(&text.0) { Some(Some(n)) => u64::try_from(n).ok(), _ => None, } }

pub fn format_i8(a: i8) -> Str { let text = a.to_string(); tick(text.len() as u64); Str::lit(&text) }

pub fn parse_i8(text: Str) -> Option<i8> { match canonical_decimal(&text.0) { Some(Some(n)) => i8::try_from(n).ok(), _ => None, } }

pub fn format_i16(a: i16) -> Str { let text = a.to_string(); tick(text.len() as u64); Str::lit(&text) }

pub fn parse_i16(text: Str) -> Option<i16> { match canonical_decimal(&text.0) { Some(Some(n)) => i16::try_from(n).ok(), _ => None, } }

pub fn format_i32(a: i32) -> Str { let text = a.to_string(); tick(text.len() as u64); Str::lit(&text) }

pub fn parse_i32(text: Str) -> Option<i32> { match canonical_decimal(&text.0) { Some(Some(n)) => i32::try_from(n).ok(), _ => None, } }

pub fn format_i64(a: i64) -> Str { let text = a.to_string(); tick(text.len() as u64); Str::lit(&text) }

pub fn parse_i64(text: Str) -> Option<i64> { match canonical_decimal(&text.0) { Some(Some(n)) => i64::try_from(n).ok(), _ => None, } }

pub fn append_list<T: Clone>(p0: List<T>, p1: List<T>) -> List<T> {
    List::append(p0, p1)
}

pub fn length_list<T: Clone>(p0: List<T>) -> u64 {
    List::length(&p0)
}

pub fn index_list<T: Clone>(p0: List<T>, p1: u64) -> Option<T> {
    List::index(&p0, p1)
}

pub fn slice_list<T: Clone>(p0: List<T>, p1: u64, p2: u64) -> Option<List<T>> {
    List::slice(&p0, p1, p2)
}

pub fn append_bytes(p0: Bytes, p1: Bytes) -> Bytes {
    Bytes::append(p0, p1)
}

pub fn length_bytes(p0: Bytes) -> u64 {
    Bytes::length(&p0)
}

pub fn length_string(p0: Str) -> u64 {
    Str::length(&p0)
}

pub fn index_bytes(p0: Bytes, p1: u64) -> Option<u8> {
    Bytes::index(&p0, p1)
}

pub fn slice_bytes(p0: Bytes, p1: u64, p2: u64) -> Option<Bytes> {
    Bytes::slice(&p0, p1, p2)
}

pub fn utf8_encode(p0: Str) -> Bytes {
    Str::utf8_encode(&p0)
}

pub fn utf8_decode(p0: Bytes) -> Option<Str> {
    Bytes::utf8_decode(&p0)
}

pub fn compare_bytes(p0: Bytes, p1: Bytes) -> Ordering {
    Bytes::compare(&p0, &p1)
}

pub fn split_exact(p0: Str, p1: Str, p2: u32) -> Option<List<Str>> {
    Str::split_exact(&p0, &p1, p2)
}

pub fn join(p0: List<Str>, p1: Str) -> Str {
    Str::join(p0, &p1)
}

#[derive(Clone)]
pub enum Adt0 {
    C0(Str, Str, Str, Str, Str, Str, Str, List<Str>, List<Str>, bool, Str, Str, Str, Option<Str>, Option<Str>, Option<Str>, Str, Str, Str, Str, Str, Str, Str, List<Adt1>, Option<Str>, Option<Str>, Option<Str>),
}

#[derive(Clone)]
pub enum Adt1 {
    C0(Str, Str, u64),
}

#[derive(Clone)]
pub enum Adt2 {
    C0(List<Adt3>),
    C1(Str, Str),
}

#[derive(Clone)]
pub enum Adt3 {
    C0(Str, Str),
}

#[derive(Clone)]
pub enum Adt4 {
    C0(Adt5),
    C1(Str, Str),
}

#[derive(Clone)]
pub enum Adt5 {
    C0(Str, Adt6, Adt9),
}

#[derive(Clone)]
pub enum Adt6 {
    C0(Str, Str, Str, Str, Str, Str, Str, List<Adt7>, List<Adt7>),
}

#[derive(Clone)]
pub enum Adt7 {
    C0(Str, List<Adt8>, Option<Str>, List<Str>),
}

#[derive(Clone)]
pub enum Adt8 {
    C0(Str, Str),
}

#[derive(Clone)]
pub enum Adt9 {
    C0(Str, Str, Str, Option<Str>, Str, Str, Str, Adt10),
}

#[derive(Clone)]
pub enum Adt10 {
    C0,
    C1(Adt11),
}

#[derive(Clone)]
pub enum Adt11 {
    C0(Str, Str, Str, Str, List<Adt12>, List<Adt13>),
}

#[derive(Clone)]
pub enum Adt12 {
    C0(Str, Str, u64),
}

#[derive(Clone)]
pub enum Adt13 {
    C0(Str, Option<Str>),
}

#[derive(Clone)]
pub enum Adt14 {
    C0(Str, Str, List<Adt15>),
    C1(u64, Bytes, Str),
}

#[derive(Clone)]
pub enum Adt15 {
    C0(bool, Adt7),
}

#[derive(Clone)]
pub enum Adt16 {
    C0(Adt15),
    C1,
    C2(Str),
}

#[derive(Clone)]
pub enum Adt17 {
    C0(List<Adt8>),
    C1(Str),
}

pub fn f0(v0: Adt0) -> R<Adt2> {
    let m1 = f1(v0)?;
    match m1 {
        Adt4::C0(v1) => {
            f2(v1)
        }
        Adt4::C1(v2, v3) => {
            Ok(Adt2::C1(v2, v3))
        }
    }
}

pub fn f1(v0: Adt0) -> R<Adt4> {
    let v1: Str = match v0.clone() {
        Adt0::C0(_, h2, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h2
        }
    };
    let a5 = f3({
        let a4 = match v0.clone() {
            Adt0::C0(_, _, _, _, _, h3, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h3
            }
        };
        utf8_encode(a4)
    });
    let a6 = 0u64;
    if nat_eq(a5, a6) {
        Ok(f4(Str::lit("generate.world"), f5(List::cons(Str::lit("the holo declares no world generate knows ("), List::cons({
            let a8 = f3({
                let a7 = v1.clone();
                utf8_encode(a7)
            });
            let a9 = 0u64;
            if nat_eq(a8, a9) {
                Str::lit("none")
            } else {
                v1
            }
        }, List::cons(Str::lit(")"), List::<Str>::nil()))))))
    } else {
        if match v0.clone() {
            Adt0::C0(_, _, _, _, _, _, _, _, _, h10, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h10
            }
        } {
            let a13 = f3({
                let a12 = match v0.clone() {
                    Adt0::C0(_, _, _, _, _, _, _, _, _, _, h11, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                        h11
                    }
                };
                utf8_encode(a12)
            });
            let a14 = 0u64;
            if nat_eq(a13, a14) {
                Ok(f4(Str::lit("generate.world"), f5(List::cons(Str::lit("generate has no WIT file for the world "), List::cons(v1, List::<Str>::nil())))))
            } else {
                let a17 = match v0.clone() {
                    Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, h15, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                        h15
                    }
                };
                let a18 = match v0.clone() {
                    Adt0::C0(_, _, _, _, _, h16, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                        h16
                    }
                };
                if if equal(a17, a18) {
                    let a21 = match v0.clone() {
                        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, h19, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                            h19
                        }
                    };
                    let a22 = match v0.clone() {
                        Adt0::C0(_, _, _, _, _, _, h20, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                            h20
                        }
                    };
                    equal(a21, a22)
                } else {
                    false
                } {
                    let m24 = f6(match v0.clone() {
                        Adt0::C0(_, _, _, _, _, _, _, _, _, _, h23, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                            h23
                        }
                    })?;
                    match m24 {
                        Adt14::C0(v5, v6, v7) => {
                            f8(v0, v5, v6, v7)
                        }
                        Adt14::C1(v2, v3, v4) => {
                            Ok(f4(Str::lit("generate.wit"), f7(v2, v3, v4)?))
                        }
                    }
                } else {
                    Ok(f4(Str::lit("generate.world"), f5(List::cons(Str::lit("the vendored "), List::cons(match v0.clone() {
                        Adt0::C0(_, _, _, _, h25, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                            h25
                        }
                    }, List::cons(Str::lit(" is not the world "), List::cons(v1, List::cons(Str::lit(" names (blake3 "), List::cons(match v0.clone() {
                        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, h26, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                            h26
                        }
                    }, List::cons(Str::lit(", expected "), List::cons(match v0 {
                        Adt0::C0(_, _, _, _, _, h27, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                            h27
                        }
                    }, List::cons(Str::lit(")"), List::<Str>::nil()))))))))))))
                }
            }
        } else {
            Ok(f4(Str::lit("generate.world"), f5(List::cons(Str::lit("the guest does not conform to "), List::cons(v1, List::cons(Str::lit("; inspect the holo to see why"), List::<Str>::nil()))))))
        }
    }
}

pub fn f2(v0: Adt5) -> R<Adt2> {
    Ok(f9(f10(f11(Str::lit("js"), match v0.clone() {
        Adt5::C0(_, h28, _) => {
            h28
        }
    }), f12(Str::lit("js"), false, f13(), {
        let m31 = match v0.clone() {
            Adt5::C0(_, h30, _) => {
                h30
            }
        };
        match m31 {
            Adt6::C0(_, _, _, _, _, _, _, _, h29) => {
                h29
            }
        }
    })?), f14(v0)?))
}

pub fn f3(v0: Bytes) -> u64 {
    let a32 = v0;
    length_bytes(a32)
}

pub fn f4(v0: Str, v1: Str) -> Adt4 {
    Adt4::C1(v0, v1)
}

pub fn f5(v0: List<Str>) -> Str {
    let a33 = v0;
    let a34 = Str::lit("");
    join(a33, a34)
}

pub fn f6(v0: Str) -> R<Adt14> {
    f15(f16({
        let a35 = v0;
        utf8_encode(a35)
    }, Bytes::lit(&[0x0a]))?, 1u64, None::<Str>, None::<Str>, false, List::<Str>::nil(), List::<Adt15>::nil())
}

pub fn f7(v0: u64, v1: Bytes, v2: Str) -> R<Str> {
    let a36 = v0;
    let a37 = 0u64;
    if nat_eq(a36, a37) {
        Ok(v2)
    } else {
        Ok(f5(List::cons(Str::lit("line "), List::cons(f17(v0)?, List::cons(Str::lit(": "), List::cons({
            let a39 = f3({
                let a38 = v2.clone();
                utf8_encode(a38)
            });
            let a40 = 0u64;
            if nat_eq(a39, a40) {
                f5(List::cons(f18(f19(v1))?, List::cons(Str::lit(" is outside the WIT subset generate reads"), List::<Str>::nil())))
            } else {
                v2
            }
        }, List::<Str>::nil()))))))
    }
}

pub fn f8(v0: Adt0, v1: Str, v2: Str, v3: List<Adt15>) -> R<Adt4> {
    let v4: Str = match v0.clone() {
        Adt0::C0(_, _, _, _, h41, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h41
        }
    };
    let v5: Str = match v0.clone() {
        Adt0::C0(_, h42, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h42
        }
    };
    let a44 = v1.clone();
    let a45 = match v0.clone() {
        Adt0::C0(_, _, h43, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h43
        }
    };
    if if equal(a44, a45) {
        let a47 = v2.clone();
        let a48 = match v0.clone() {
            Adt0::C0(_, _, _, h46, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h46
            }
        };
        equal(a47, a48)
    } else {
        false
    } {
        f20(v0, v1, v2, f21(v3.clone(), true), f21(v3, false))
    } else {
        Ok(f4(Str::lit("generate.world"), f5(List::cons(v4, List::cons(Str::lit(" declares "), List::cons(v1, List::cons(Str::lit(" world "), List::cons(v2, List::cons(Str::lit("; "), List::cons(v5, List::cons(Str::lit(" is "), List::cons(match v0.clone() {
            Adt0::C0(_, _, h49, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h49
            }
        }, List::cons(Str::lit(" world "), List::cons(match v0 {
            Adt0::C0(_, _, _, h50, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h50
            }
        }, List::<Str>::nil()))))))))))))))
    }
}

pub fn f9(v0: Option<(Str, Str)>, v1: List<Adt3>) -> Adt2 {
    let m51 = v0;
    match m51 {
        None => {
            Adt2::C0(v1)
        }
        Some(v2) => {
            Adt2::C1({
                let (h52, _) = v2;
                h52
            }, {
                let (_, h53) = v2;
                h53
            })
        }
    }
}

pub fn f10(v0: Option<(Str, Str)>, v1: Option<(Str, Str)>) -> Option<(Str, Str)> {
    let m54 = v0.clone();
    match m54 {
        None => {
            v1
        }
        Some(_) => {
            v0
        }
    }
}

pub fn f11(v0: Str, v1: Adt6) -> Option<(Str, Str)> {
    let a58 = {
        let a56 = match v1.clone() {
            Adt6::C0(h55, _, _, _, _, _, _, _, _) => {
                h55
            }
        };
        let a57 = Str::lit("hologram:guest/core-wasm@1");
        equal(a56, a57)
    };
    if bool_not(a58) {
        Some((Str::lit("generate.world"), f5(List::cons(Str::lit("the "), List::cons(v0, List::cons(Str::lit(" writer has no host protocol for "), List::cons(match v1 {
            Adt6::C0(h59, _, _, _, _, _, _, _, _) => {
                h59
            }
        }, List::<Str>::nil())))))))
    } else {
        let m61 = match v1.clone() {
            Adt6::C0(_, _, _, _, _, _, _, h60, _) => {
                h60
            }
        };
        match m61.uncons() {
            None => {
                None::<(Str, Str)>
            }
            Some((_, _)) => {
                Some((Str::lit("generate.world"), f5(List::cons(Str::lit("the "), List::cons(v0, List::cons(Str::lit(" writer binds import-free worlds; "), List::cons(match v1 {
                    Adt6::C0(h62, _, _, _, _, _, _, _, _) => {
                        h62
                    }
                }, List::cons(Str::lit(" has imports"), List::<Str>::nil()))))))))
            }
        }
    }
}

pub fn f12(v0: Str, v1: bool, v2: List<(Str, Str)>, v3: List<Adt7>) -> R<Option<(Str, Str)>> {
    let m63 = v3;
    match m63.uncons() {
        None => {
            Ok(None::<(Str, Str)>)
        }
        Some((v4, v5)) => {
            Ok(f10(if v1 {
                f22(v0.clone(), match v4.clone() {
                    Adt7::C0(h64, _, _, _) => {
                        h64
                    }
                })?
            } else {
                None::<(Str, Str)>
            }, f10(f23(v0.clone(), v1, v2.clone(), match v4.clone() {
                Adt7::C0(_, h65, _, _) => {
                    h65
                }
            })?, f10({
                let m67 = match v4 {
                    Adt7::C0(_, _, h66, _) => {
                        h66
                    }
                };
                match m67 {
                    None => {
                        None::<(Str, Str)>
                    }
                    Some(v6) => {
                        f24(v0.clone(), v6, v2.clone())
                    }
                }
            }, f12(v0, v1, v2, v5)?))))
        }
    }
}

pub fn f13() -> List<(Str, Str)> {
    List::cons((Str::lit("bool"), Str::lit("boolean")), List::cons((Str::lit("u8"), Str::lit("number")), List::cons((Str::lit("u16"), Str::lit("number")), List::cons((Str::lit("u32"), Str::lit("number")), List::cons((Str::lit("s8"), Str::lit("number")), List::cons((Str::lit("s16"), Str::lit("number")), List::cons((Str::lit("s32"), Str::lit("number")), List::cons((Str::lit("char"), Str::lit("number")), List::cons((Str::lit("u64"), Str::lit("bigint")), List::cons((Str::lit("s64"), Str::lit("bigint")), List::cons((Str::lit("f32"), Str::lit("number")), List::cons((Str::lit("f64"), Str::lit("number")), List::<(Str, Str)>::nil()))))))))))))
}

pub fn f14(v0: Adt5) -> R<List<Adt3>> {
    let v1: Str = match v0.clone() {
        Adt5::C0(h68, _, _) => {
            h68
        }
    };
    let v2: Adt9 = match v0.clone() {
        Adt5::C0(_, _, h69) => {
            h69
        }
    };
    let v3: Str = match v2.clone() {
        Adt9::C0(_, _, h70, _, _, _, _, _) => {
            h70
        }
    };
    Ok(List::cons(f25(Str::lit("world.js"), f26(v1.clone(), match v0.clone() {
        Adt5::C0(_, h71, _) => {
            h71
        }
    })?), List::cons(f25(Str::lit("world.d.ts"), f27(v1.clone(), match v0 {
        Adt5::C0(_, h72, _) => {
            h72
        }
    })?), {
        let m74 = match v2.clone() {
            Adt9::C0(_, _, _, _, _, _, _, h73) => {
                h73
            }
        };
        match m74 {
            Adt10::C0 => {
                List::cons(f25(f5(List::cons(v3.clone(), List::cons(Str::lit(".js"), List::<Str>::nil()))), f28(v1.clone(), v2.clone())?), List::cons(f25(f5(List::cons(v3, List::cons(Str::lit(".d.ts"), List::<Str>::nil()))), f29(v1, v2)?), List::<Adt3>::nil()))
            }
            Adt10::C1(v4) => {
                List::cons(f25(f5(List::cons(v3.clone(), List::cons(Str::lit(".js"), List::<Str>::nil()))), f30(v1.clone(), v2.clone(), v4.clone())?), List::cons(f25(f5(List::cons(v3, List::cons(Str::lit(".d.ts"), List::<Str>::nil()))), f31(v1, v2, v4)?), List::<Adt3>::nil()))
            }
        }
    })))
}

pub fn f15(p101: List<Bytes>, p102: u64, p103: Option<Str>, p104: Option<Str>, p105: bool, p106: List<Str>, p107: List<Adt15>) -> R<Adt14> {
    let m100 = (p101, (p102, (p103, (p104, (p105, (p106, p107))))));
    {
        let mut m100 = m100;
        loop {
            let step = {
                let (v0, (v1, (v2, (v3, (v4, (v5, v6)))))) = m100;
                let m75 = v0;
                match m75.uncons() {
                    None => {
                        let m76 = v2;
                        match m76 {
                            None => {
                                Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(Adt14::C1(0u64, Bytes::lit(&[]), Str::lit("the WIT text has no complete package and world"))))
                            }
                            Some(v7) => {
                                let m77 = v3;
                                match m77 {
                                    None => {
                                        Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(Adt14::C1(0u64, Bytes::lit(&[]), Str::lit("the WIT text has no complete package and world"))))
                                    }
                                    Some(v8) => {
                                        if v4 {
                                            Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(Adt14::C0(v7, v8, v6)))
                                        } else {
                                            Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(Adt14::C1(0u64, Bytes::lit(&[]), Str::lit("the WIT text has no complete package and world"))))
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Some((v9, v10)) => {
                        let v11: Bytes = f32(v9)?;
                        if f33(v11.clone(), Bytes::lit(&[0x2f, 0x2f, 0x2f])) {
                            Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                let a78 = v1;
                                let a79 = 1u64;
                                nat_add(a78, a79)?
                            }, (v2, (v3, (v4, ({
                                let a80 = v5;
                                let a81 = List::cons(f19(f32(f34(v11, 3u64, 0u64)?)?), List::<Str>::nil());
                                append_list(a80, a81)
                            }, v6)))))))
                        } else {
                            let a82 = f3(v11.clone());
                            let a83 = 0u64;
                            if if nat_eq(a82, a83) {
                                true
                            } else {
                                f33(v11.clone(), Bytes::lit(&[0x2f, 0x2f]))
                            } {
                                Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                    let a84 = v1;
                                    let a85 = 1u64;
                                    nat_add(a84, a85)?
                                }, (v2, (v3, (v4, (List::<Str>::nil(), v6)))))))
                            } else {
                                if v4 {
                                    Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f35(v1, Str::lit("nothing may follow the world"))))
                                } else {
                                    let a86 = f36(v2.clone());
                                    if if bool_not(a86) {
                                        let a87 = f36(v3.clone());
                                        if bool_not(a87) {
                                            if f33(v11.clone(), Bytes::lit(&[0x70, 0x61, 0x63, 0x6b, 0x61, 0x67, 0x65, 0x20])) {
                                                if f37(v11.clone(), Bytes::lit(&[0x3b]))? {
                                                    f38(f34(v11.clone(), 8u64, 1u64)?)?
                                                } else {
                                                    false
                                                }
                                            } else {
                                                false
                                            }
                                        } else {
                                            false
                                        }
                                    } else {
                                        false
                                    } {
                                        Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                            let a88 = v1;
                                            let a89 = 1u64;
                                            nat_add(a88, a89)?
                                        }, (Some(f19(f34(v11, 8u64, 1u64)?)), (v3, (v4, (List::<Str>::nil(), v6)))))))
                                    } else {
                                        if if f36(v2.clone()) {
                                            let a90 = f36(v3.clone());
                                            if bool_not(a90) {
                                                if f33(v11.clone(), Bytes::lit(&[0x77, 0x6f, 0x72, 0x6c, 0x64, 0x20])) {
                                                    if f37(v11.clone(), Bytes::lit(&[0x20, 0x7b]))? {
                                                        f39(f34(v11.clone(), 6u64, 2u64)?)?
                                                    } else {
                                                        false
                                                    }
                                                } else {
                                                    false
                                                }
                                            } else {
                                                false
                                            }
                                        } else {
                                            false
                                        } {
                                            Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                                let a91 = v1;
                                                let a92 = 1u64;
                                                nat_add(a91, a92)?
                                            }, (v2, (Some(f19(f34(v11, 6u64, 2u64)?)), (v4, (List::<Str>::nil(), v6)))))))
                                        } else {
                                            if if f36(v3.clone()) {
                                                if f33(v11.clone(), Bytes::lit(&[0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20])) {
                                                    true
                                                } else {
                                                    f33(v11.clone(), Bytes::lit(&[0x69, 0x6d, 0x70, 0x6f, 0x72, 0x74, 0x20]))
                                                }
                                            } else {
                                                false
                                            } {
                                                let m93 = f40(v11.clone(), v5)?;
                                                match m93 {
                                                    Adt16::C0(v12) => {
                                                        Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                                            let a94 = v1;
                                                            let a95 = 1u64;
                                                            nat_add(a94, a95)?
                                                        }, (v2, (v3, (v4, (List::<Str>::nil(), {
                                                            let a96 = v6;
                                                            let a97 = List::cons(v12, List::<Adt15>::nil());
                                                            append_list(a96, a97)
                                                        })))))))
                                                    }
                                                    Adt16::C1 => {
                                                        Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f41(v1, v11)))
                                                    }
                                                    Adt16::C2(v13) => {
                                                        Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f35(v1, v13)))
                                                    }
                                                }
                                            } else {
                                                if if f36(v3.clone()) {
                                                    f42(v11.clone(), Bytes::lit(&[0x7d]))
                                                } else {
                                                    false
                                                } {
                                                    Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                                        let a98 = v1;
                                                        let a99 = 1u64;
                                                        nat_add(a98, a99)?
                                                    }, (v2, (v3, (true, (List::<Str>::nil(), v6)))))))
                                                } else {
                                                    Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f41(v1, v11)))
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m100 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f16(v0: Bytes, v1: Bytes) -> R<List<Bytes>> {
    f43(v0.clone(), v1, 0u64, Bytes::lit(&[]), f3(v0))
}

pub fn f17(v0: u64) -> R<Str> {
    Ok(f44(v0, {
        let a108 = v0;
        let a109 = 1u64;
        nat_add(a108, a109)?
    }))
}

pub fn f18(v0: Str) -> R<Str> {
    f45(v0, Bytes::lit(&[0x22]))
}

pub fn f19(v0: Bytes) -> Str {
    f46(v0, Str::lit(""))
}

pub fn f20(v0: Adt0, v1: Str, v2: Str, v3: List<Adt7>, v4: List<Adt7>) -> R<Adt4> {
    let v5: Str = match v0.clone() {
        Adt0::C0(_, _, _, _, h110, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h110
        }
    };
    let v6: Str = match v0.clone() {
        Adt0::C0(_, h111, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h111
        }
    };
    if if f47(f48(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, h112, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h112
        }
    }, f49(v3.clone())))? {
        let a114 = f50(f48(f49(v3.clone()), match v0.clone() {
            Adt0::C0(_, _, _, _, _, _, _, h113, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h113
            }
        }))?;
        let a115 = 0u64;
        nat_eq(a114, a115)
    } else {
        false
    } {
        let a117 = f51(v4.clone())?;
        let a118 = f50(match v0.clone() {
            Adt0::C0(_, _, _, _, _, _, _, _, h116, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h116
            }
        })?;
        if nat_eq(a117, a118) {
            let v7: Adt6 = Adt6::C0(v6, v1, v2, v5, match v0.clone() {
                Adt0::C0(_, _, _, _, _, h119, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h119
                }
            }, match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, h120, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h120
                }
            }, Str::lit("memory"), v4, v3);
            let m122 = match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, h121, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h121
                }
            };
            match m122 {
                None => {
                    let m124 = match v0.clone() {
                        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h123, _, _, _, _, _, _, _, _, _, _, _, _) => {
                            h123
                        }
                    };
                    match m124 {
                        None => {
                            Ok(f4(Str::lit("generate.model"), Str::lit("the application has no name")))
                        }
                        Some(v9) => {
                            f52(v0, v7, v9)
                        }
                    }
                }
                Some(v8) => {
                    f52(v0, v7, v8)
                }
            }
        } else {
            Ok(f4(Str::lit("generate.world"), f5(List::cons(Str::lit("the imports of "), List::cons(v5, List::cons(Str::lit(" do not match "), List::cons(v6, List::<Str>::nil())))))))
        }
    } else {
        Ok(f4(Str::lit("generate.world"), f5(List::cons(Str::lit("the exports of "), List::cons(v5, List::cons(Str::lit(" do not match "), List::cons(v6, List::cons(Str::lit(": "), List::cons({
            let a126 = match v0 {
                Adt0::C0(_, _, _, _, _, _, _, h125, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h125
                }
            };
            let a127 = Str::lit(", ");
            join(a126, a127)
        }, List::<Str>::nil())))))))))
    }
}

pub fn f21(v0: List<Adt15>, v1: bool) -> List<Adt7> {
    let m128 = v0;
    match m128.uncons() {
        None => {
            List::<Adt7>::nil()
        }
        Some((v2, v3)) => {
            if if v1 {
                match v2.clone() {
                    Adt15::C0(h129, _) => {
                        h129
                    }
                }
            } else {
                let a131 = match v2.clone() {
                    Adt15::C0(h130, _) => {
                        h130
                    }
                };
                bool_not(a131)
            } {
                List::cons(match v2 {
                    Adt15::C0(_, h132) => {
                        h132
                    }
                }, f21(v3, v1))
            } else {
                f21(v3, v1)
            }
        }
    }
}

pub fn f22(v0: Str, v1: Str) -> R<Option<(Str, Str)>> {
    if f53(v1.clone())? {
        Ok(None::<(Str, Str)>)
    } else {
        Ok(Some((Str::lit("generate.model"), f5(List::cons(f18(v1)?, List::cons(Str::lit(" is not a name the "), List::cons(v0, List::cons(Str::lit(" writer can bind"), List::<Str>::nil()))))))))
    }
}

pub fn f23(v0: Str, v1: bool, v2: List<(Str, Str)>, v3: List<Adt8>) -> R<Option<(Str, Str)>> {
    let m133 = v3;
    match m133.uncons() {
        None => {
            Ok(None::<(Str, Str)>)
        }
        Some((v4, v5)) => {
            Ok(f10(if v1 {
                f22(v0.clone(), f54(match v4.clone() {
                    Adt8::C0(h134, _) => {
                        h134
                    }
                })?)?
            } else {
                None::<(Str, Str)>
            }, f10(f24(v0.clone(), match v4 {
                Adt8::C0(_, h135) => {
                    h135
                }
            }, v2.clone()), f23(v0, v1, v2, v5)?)))
        }
    }
}

pub fn f24(v0: Str, v1: Str, v2: List<(Str, Str)>) -> Option<(Str, Str)> {
    let m136 = f55(v1.clone(), v2);
    match m136 {
        None => {
            Some((Str::lit("generate.world"), f5(List::cons(Str::lit("the "), List::cons(v0, List::cons(Str::lit(" writer has no type for WIT "), List::cons(v1, List::<Str>::nil())))))))
        }
        Some(_) => {
            None::<(Str, Str)>
        }
    }
}

pub fn f25(v0: Str, v1: Str) -> Adt3 {
    Adt3::C0(v0, v1)
}

pub fn f26(v0: Str, v1: Adt6) -> R<Str> {
    Ok(f56({
        let a151 = List::cons(f57(Str::lit("//"), v0, f58(v1.clone())), List::cons(Str::lit("/** The world these bindings were generated from. It equals `inputs.world` in prismpm.lock. */\u{a}export const WORLD = Object.freeze({"), List::cons(f5(List::cons(Str::lit("  contract: "), List::cons(f59(match v1.clone() {
            Adt6::C0(h137, _, _, _, _, _, _, _, _) => {
                h137
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("  blake3: "), List::cons(f59(match v1.clone() {
            Adt6::C0(_, _, _, _, h138, _, _, _, _) => {
                h138
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("  sha256: "), List::cons(f59(match v1.clone() {
            Adt6::C0(_, _, _, _, _, h139, _, _, _) => {
                h139
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(Str::lit("});\u{a}\u{a}/** Every export the world requires, and its kind. */\u{a}const EXPORTS = Object.freeze({"), List::<Str>::nil()))))));
        let a152 = {
            let a149 = f60(f61(List::cons((match v1.clone() {
                Adt6::C0(_, _, _, _, _, _, h140, _, _) => {
                    h140
                }
            }, Str::lit("memory")), f62(match v1.clone() {
                Adt6::C0(_, _, _, _, _, _, _, _, h141) => {
                    h141
                }
            }))))?;
            let a150 = {
                let a147 = List::cons(Str::lit("});\u{a}\u{a}/**\u{a} * Instantiate a compiled guest and check that it offers exactly the world's exports.\u{a} * The guest imports nothing.\u{a} * @param {WebAssembly.Module} module\u{a} */\u{a}export function instantiate(module) {\u{a}  const { exports } = new WebAssembly.Instance(module, {});\u{a}  const names = Object.keys(exports).sort();\u{a}  const expected = Object.keys(EXPORTS).sort();\u{a}  if (names.join() !== expected.join() || names.some((name) => kindOf(exports[name]) !== EXPORTS[name])) {\u{a}    throw new TypeError(`the guest exports ${names.join(', ')}; ${WORLD.contract} requires ${expected.join(', ')}`);\u{a}  }\u{a}  return {"), List::cons(f5(List::cons(Str::lit("    "), List::cons(match v1.clone() {
                    Adt6::C0(_, _, _, _, _, _, h142, _, _) => {
                        h142
                    }
                }, List::cons(Str::lit(": exports."), List::cons(match v1.clone() {
                    Adt6::C0(_, _, _, _, _, _, h143, _, _) => {
                        h143
                    }
                }, List::cons(Str::lit(","), List::<Str>::nil())))))), List::<Str>::nil()));
                let a148 = {
                    let a145 = f63(match v1 {
                        Adt6::C0(_, _, _, _, _, _, _, _, h144) => {
                            h144
                        }
                    })?;
                    let a146 = List::cons(Str::lit("  };\u{a}}\u{a}\u{a}function kindOf(value) {\u{a}  return value instanceof WebAssembly.Memory ? 'memory' : typeof value === 'function' ? 'function' : 'other';\u{a}}\u{a}"), List::cons(f64(), List::<Str>::nil()));
                    append_list(a145, a146)
                };
                append_list(a147, a148)
            };
            append_list(a149, a150)
        };
        append_list(a151, a152)
    }))
}

pub fn f27(v0: Str, v1: Adt6) -> R<Str> {
    Ok(f56({
        let a159 = List::cons(f57(Str::lit("//"), v0, f58(v1.clone())), List::cons(Str::lit("/** The world these bindings were generated from. It equals `inputs.world` in prismpm.lock. */\u{a}export declare const WORLD: {"), List::cons(f5(List::cons(Str::lit("  readonly contract: "), List::cons(f59(match v1.clone() {
            Adt6::C0(h153, _, _, _, _, _, _, _, _) => {
                h153
            }
        })?, List::cons(Str::lit(";"), List::<Str>::nil())))), List::cons(Str::lit("  readonly blake3: string;\u{a}  readonly sha256: string;\u{a}};\u{a}"), List::cons(f5(List::cons(Str::lit("/** A guest of "), List::cons(match v1.clone() {
            Adt6::C0(h154, _, _, _, _, _, _, _, _) => {
                h154
            }
        }, List::cons(Str::lit(", instantiated. */\u{a}export interface Guest {"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("  readonly "), List::cons(match v1.clone() {
            Adt6::C0(_, _, _, _, _, _, h155, _, _) => {
                h155
            }
        }, List::cons(Str::lit(": WebAssembly.Memory;"), List::<Str>::nil())))), List::<Str>::nil()))))));
        let a160 = {
            let a157 = f65(match v1 {
                Adt6::C0(_, _, _, _, _, _, _, _, h156) => {
                    h156
                }
            })?;
            let a158 = List::cons(Str::lit("}\u{a}\u{a}/** Instantiate a compiled guest and check that it offers exactly the world's exports. */\u{a}export declare function instantiate(module: WebAssembly.Module): Guest;\u{a}"), List::cons(f66(), List::<Str>::nil()));
            append_list(a157, a158)
        };
        append_list(a159, a160)
    }))
}

pub fn f28(v0: Str, v1: Adt9) -> R<Str> {
    let v2: Str = match v1.clone() {
        Adt9::C0(h161, _, _, _, _, _, _, _) => {
            h161
        }
    };
    Ok(f56({
        let a167 = List::cons(f57(Str::lit("//"), v0, f67(v1.clone())), List::cons(f68(v1.clone())?, List::cons(Str::lit("\u{a}/**"), List::<Str>::nil())));
        let a168 = {
            let a165 = f69({
                let a162 = f70(v1.clone(), f5(List::cons(Str::lit("A client for "), List::cons(v2.clone(), List::cons(Str::lit(", over request and response bytes."), List::<Str>::nil())))));
                let a163 = List::cons(Str::lit(""), List::<Str>::nil());
                append_list(a162, a163)
            });
            let a166 = List::cons(f5(List::cons(Str::lit(" * "), List::cons(v2, List::cons(Str::lit("'s model describes no typed operations, so the client sends bytes.\u{a} * `dispatch` is `app.dispatch` of an application prism-code's `load()` opened, or\u{a} * `(request) => dispatch(module, request)` with `dispatch` from ./world.js.\u{a} */\u{a}"), List::cons(f71(match v1 {
                Adt9::C0(_, h164, _, _, _, _, _, _) => {
                    h164
                }
            }), List::cons(Str::lit("\u{a}\u{a}  /** Send one request and resolve to the response bytes. */\u{a}  async invoke(request) {\u{a}    return this.#dispatch(request);\u{a}  }\u{a}}"), List::<Str>::nil())))))), List::<Str>::nil());
            append_list(a165, a166)
        };
        append_list(a167, a168)
    }))
}

pub fn f29(v0: Str, v1: Adt9) -> R<Str> {
    Ok(f56({
        let a173 = List::cons(f57(Str::lit("//"), v0, f67(v1.clone())), List::cons(f72(v1.clone())?, List::cons(Str::lit("\u{a}/** Sends request bytes to the guest and returns its response bytes. */\u{a}export type Dispatch = (request: Uint8Array) => Uint8Array | Promise<Uint8Array>;\u{a}"), List::<Str>::nil())));
        let a174 = {
            let a171 = f73(Str::lit(""), f70(v1.clone(), f5(List::cons(Str::lit("A client for "), List::cons(match v1.clone() {
                Adt9::C0(h169, _, _, _, _, _, _, _) => {
                    h169
                }
            }, List::cons(Str::lit(", over request and response bytes."), List::<Str>::nil()))))));
            let a172 = List::cons(f5(List::cons(Str::lit("export declare class "), List::cons(match v1 {
                Adt9::C0(_, h170, _, _, _, _, _, _) => {
                    h170
                }
            }, List::cons(Str::lit(" {\u{a}  constructor(dispatch: Dispatch);\u{a}  /** Send one request and resolve to the response bytes. */\u{a}  invoke(request: Uint8Array): Promise<Uint8Array>;\u{a}}"), List::<Str>::nil())))), List::<Str>::nil());
            append_list(a171, a172)
        };
        append_list(a173, a174)
    }))
}

pub fn f30(v0: Str, v1: Adt9, v2: Adt11) -> R<Str> {
    let v3: Str = match v1.clone() {
        Adt9::C0(h175, _, _, _, _, _, _, _) => {
            h175
        }
    };
    let v4: Str = match v2.clone() {
        Adt11::C0(_, _, _, h176, _, _) => {
            h176
        }
    };
    let v5: Str = match v2.clone() {
        Adt11::C0(_, h177, _, _, _, _) => {
            h177
        }
    };
    Ok(f56({
        let a199 = List::cons(f57(Str::lit("//"), v0, f67(v1.clone())), List::cons(f68(v1.clone())?, List::cons(f5(List::cons(Str::lit("\u{a}/** Every operation "), List::cons(v3.clone(), List::cons(Str::lit(" accepts, by its request name. */\u{a}export const OPERATIONS = Object.freeze(["), List::cons({
            let a179 = f74(match v2.clone() {
                Adt11::C0(_, _, _, _, h178, _) => {
                    h178
                }
            })?;
            let a180 = Str::lit(", ");
            join(a179, a180)
        }, List::cons(Str::lit("]);\u{a}\u{a}const VERSION = "), List::cons(f59(match v2.clone() {
            Adt11::C0(h181, _, _, _, _, _) => {
                h181
            }
        })?, List::cons(Str::lit(";\u{a}const MIN = -(2n ** 63n);\u{a}const MAX = 2n ** 63n - 1n;\u{a}const MESSAGES = Object.freeze({"), List::<Str>::nil())))))))), List::<Str>::nil())));
        let a200 = {
            let a197 = f75(v1.clone(), match v2.clone() {
                Adt11::C0(h182, _, _, _, _, _) => {
                    h182
                }
            }, match v2.clone() {
                Adt11::C0(_, _, _, _, _, h183) => {
                    h183
                }
            })?;
            let a198 = {
                let a195 = List::cons(f5(List::cons(Str::lit("});\u{a}\u{a}const encoder = new TextEncoder();\u{a}const decoder = new TextDecoder('utf-8', { fatal: true });\u{a}\u{a}/** A request "), List::cons(v3.clone(), List::cons(Str::lit(" refused. `code` is the guest's answer, such as `"), List::cons(f76(match v2.clone() {
                    Adt11::C0(_, _, _, _, _, h184) => {
                        h184
                    }
                }), List::cons(Str::lit("`. */\u{a}export class "), List::cons(v4.clone(), List::cons(Str::lit(" extends Error {\u{a}  constructor(code) {\u{a}    super(MESSAGES[code] ?? `"), List::cons(v3.clone(), List::cons(Str::lit(" refused the request: ${code}.`);\u{a}    this.name = "), List::cons(f59(v4.clone())?, List::cons(Str::lit(";\u{a}    this.code = code;\u{a}  }\u{a}}\u{a}\u{a}/**"), List::<Str>::nil())))))))))))), List::<Str>::nil());
                let a196 = {
                    let a193 = f69({
                        let a185 = f70(v1.clone(), f5(List::cons(Str::lit("A client for "), List::cons(v3.clone(), List::cons(Str::lit("."), List::<Str>::nil())))));
                        let a186 = List::cons(Str::lit(""), List::<Str>::nil());
                        append_list(a185, a186)
                    });
                    let a194 = {
                        let a191 = List::cons(f5(List::cons(Str::lit(" * `dispatch` sends request bytes to the guest and returns its response bytes:\u{a} * `app.dispatch` of an application prism-code's `load()` opened, or\u{a} * `(request) => dispatch(module, request)` with `dispatch` from ./world.js.\u{a} */\u{a}"), List::cons(f71(match v1 {
                            Adt9::C0(_, h187, _, _, _, _, _, _) => {
                                h187
                            }
                        }), List::<Str>::nil()))), List::<Str>::nil());
                        let a192 = {
                            let a189 = f77(v5.clone(), match v2 {
                                Adt11::C0(_, _, _, _, h188, _) => {
                                    h188
                                }
                            })?;
                            let a190 = List::cons(f5(List::cons(Str::lit("\u{a}  /**\u{a}   * Apply `operation` to two signed 64-bit integers. Resolves to the result;\u{a}   * rejects with "), List::cons(v4.clone(), List::cons(Str::lit(" when "), List::cons(v3, List::cons(Str::lit(" refuses, for example on overflow.\u{a}   */\u{a}  async "), List::cons(v5, List::cons(Str::lit("(operation, left, right) {\u{a}    if (!OPERATIONS.includes(operation)) throw new TypeError(`unknown operation ${operation}`);\u{a}    const request = encoder.encode(`${VERSION}\\t${operation}\\t${int64(left)}\\t${int64(right)}`);\u{a}    const [version, status, value] = decoder.decode(await this.#dispatch(request)).split('\\t');\u{a}    if (version !== VERSION) throw new "), List::cons(v4.clone(), List::cons(Str::lit("('unsupported-version');\u{a}    if (status === 'ok') return BigInt(value);\u{a}    throw new "), List::cons(v4, List::cons(Str::lit("(value);\u{a}  }\u{a}}\u{a}\u{a}function int64(value) {\u{a}  const n = typeof value === 'bigint' ? value : Number.isSafeInteger(value) ? BigInt(value) : null;\u{a}  if (n === null || n < MIN || n > MAX) throw new RangeError(`${value} is not a signed 64-bit integer`);\u{a}  return n.toString();\u{a}}"), List::<Str>::nil())))))))))))), List::<Str>::nil());
                            append_list(a189, a190)
                        };
                        append_list(a191, a192)
                    };
                    append_list(a193, a194)
                };
                append_list(a195, a196)
            };
            append_list(a197, a198)
        };
        append_list(a199, a200)
    }))
}

pub fn f31(v0: Str, v1: Adt9, v2: Adt11) -> R<Str> {
    let v3: Str = match v1.clone() {
        Adt9::C0(h201, _, _, _, _, _, _, _) => {
            h201
        }
    };
    let v4: Str = match v2.clone() {
        Adt11::C0(_, _, _, h202, _, _) => {
            h202
        }
    };
    let v5: Str = f5(List::cons(v4.clone(), List::cons(Str::lit("Code"), List::<Str>::nil())));
    Ok(f56({
        let a222 = List::cons(f57(Str::lit("//"), v0, f67(v1.clone())), List::cons(f72(v1.clone())?, List::cons(f5(List::cons(Str::lit("\u{a}/** An operation "), List::cons(v3.clone(), List::cons(Str::lit(" accepts, by its request name. */\u{a}export type "), List::cons(match v2.clone() {
            Adt11::C0(_, _, h203, _, _, _) => {
                h203
            }
        }, List::cons(Str::lit(" = "), List::cons({
            let a205 = f74(match v2.clone() {
                Adt11::C0(_, _, _, _, h204, _) => {
                    h204
                }
            })?;
            let a206 = Str::lit(" | ");
            join(a205, a206)
        }, List::cons(Str::lit(";\u{a}export declare const OPERATIONS: readonly "), List::cons(match v2.clone() {
            Adt11::C0(_, _, h207, _, _, _) => {
                h207
            }
        }, List::cons(Str::lit("[];\u{a}\u{a}/** A signed 64-bit integer: a bigint, or a number that is a safe integer. */\u{a}export type Int64 = bigint | number;\u{a}\u{a}/** Every answer with which "), List::cons(v3.clone(), List::cons(Str::lit(" refuses a request. */\u{a}export type "), List::cons(v5.clone(), List::cons(Str::lit(" = "), List::cons({
            let a209 = f78(match v2.clone() {
                Adt11::C0(_, _, _, _, _, h208) => {
                    h208
                }
            })?;
            let a210 = Str::lit(" | ");
            join(a209, a210)
        }, List::cons(Str::lit(";\u{a}\u{a}/** A request "), List::cons(v3.clone(), List::cons(Str::lit(" refused. `code` is the guest's answer. */\u{a}export declare class "), List::cons(v4.clone(), List::cons(Str::lit(" extends Error {\u{a}  constructor(code: "), List::cons(v5.clone(), List::cons(Str::lit(");\u{a}  readonly code: "), List::cons(v5, List::cons(Str::lit(";\u{a}}\u{a}\u{a}/** Sends request bytes to the guest and returns its response bytes. */\u{a}export type Dispatch = (request: Uint8Array) => Uint8Array | Promise<Uint8Array>;\u{a}"), List::<Str>::nil())))))))))))))))))))))))), List::<Str>::nil())));
        let a223 = {
            let a220 = f73(Str::lit(""), f70(v1.clone(), f5(List::cons(Str::lit("A client for "), List::cons(v3.clone(), List::cons(Str::lit("."), List::<Str>::nil()))))));
            let a221 = {
                let a218 = List::cons(f5(List::cons(Str::lit("export declare class "), List::cons(match v1 {
                    Adt9::C0(_, h211, _, _, _, _, _, _) => {
                        h211
                    }
                }, List::cons(Str::lit(" {\u{a}  constructor(dispatch: Dispatch);"), List::<Str>::nil())))), List::<Str>::nil());
                let a219 = {
                    let a216 = f79(match v2.clone() {
                        Adt11::C0(_, h212, _, _, _, _) => {
                            h212
                        }
                    }, match v2.clone() {
                        Adt11::C0(_, _, _, _, h213, _) => {
                            h213
                        }
                    })?;
                    let a217 = List::cons(f5(List::cons(Str::lit("  /** Apply `operation` to two signed 64-bit integers; rejects with "), List::cons(v4, List::cons(Str::lit(" when "), List::cons(v3, List::cons(Str::lit(" refuses. */\u{a}  "), List::cons(match v2.clone() {
                        Adt11::C0(_, h214, _, _, _, _) => {
                            h214
                        }
                    }, List::cons(Str::lit("(operation: "), List::cons(match v2 {
                        Adt11::C0(_, _, h215, _, _, _) => {
                            h215
                        }
                    }, List::cons(Str::lit(", left: Int64, right: Int64): Promise<bigint>;\u{a}}"), List::<Str>::nil())))))))))), List::<Str>::nil());
                    append_list(a216, a217)
                };
                append_list(a218, a219)
            };
            append_list(a220, a221)
        };
        append_list(a222, a223)
    }))
}

pub fn f32(v0: Bytes) -> R<Bytes> {
    let v1: u64 = f80(v0.clone(), 0u64, f3(v0.clone()))?;
    let v2: u64 = f81(v0.clone(), 0u64, f3(v0.clone()), 0u64)?;
    let a224 = v2;
    let a225 = v1;
    if nat_le(a224, a225) {
        Ok(Bytes::lit(&[]))
    } else {
        Ok(f82(v0, v1, f83(v2, v1)?))
    }
}

pub fn f33(v0: Bytes, v1: Bytes) -> bool {
    f42(f82(v0, 0u64, f3(v1.clone())), v1)
}

pub fn f34(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let a228 = {
        let a226 = v1;
        let a227 = v2;
        nat_add(a226, a227)?
    };
    let a229 = f3(v0.clone());
    if nat_le(a228, a229) {
        Ok(f82(v0.clone(), v1, f83(f3(v0), {
            let a230 = v1;
            let a231 = v2;
            nat_add(a230, a231)?
        })?))
    } else {
        Ok(Bytes::lit(&[]))
    }
}

pub fn f35(v0: u64, v1: Str) -> Adt14 {
    Adt14::C1(v0, Bytes::lit(&[]), v1)
}

pub fn f36(v0: Option<Str>) -> bool {
    let m232 = v0;
    match m232 {
        None => {
            false
        }
        Some(_) => {
            true
        }
    }
}

pub fn f37(v0: Bytes, v1: Bytes) -> R<bool> {
    let a233 = f3(v1.clone());
    let a234 = f3(v0.clone());
    if nat_le(a233, a234) {
        Ok(f42(f82(v0.clone(), f83(f3(v0), f3(v1.clone()))?, f3(v1.clone())), v1))
    } else {
        Ok(false)
    }
}

pub fn f38(v0: Bytes) -> R<bool> {
    let m235 = f84(v0.clone(), Bytes::lit(&[0x3a]), 0u64, f3(v0.clone()))?;
    match m235 {
        None => {
            Ok(false)
        }
        Some(v1) => {
            if f39(f82(v0.clone(), 0u64, v1))? {
                f85(f34(v0, {
                    let a236 = v1;
                    let a237 = 1u64;
                    nat_add(a236, a237)?
                }, 0u64)?)
            } else {
                Ok(false)
            }
        }
    }
}

pub fn f39(v0: Bytes) -> R<bool> {
    if f86(f82(v0.clone(), 0u64, 1u64)) {
        f87(v0.clone(), 0u64, f3(v0), false)
    } else {
        Ok(false)
    }
}

pub fn f40(v0: Bytes, v1: List<Str>) -> R<Adt16> {
    let v2: Bytes = f34(v0.clone(), 7u64, 0u64)?;
    let m238 = f84(v2.clone(), Bytes::lit(&[0x3a]), 0u64, f3(v2.clone()))?;
    match m238 {
        None => {
            Ok(Adt16::C1)
        }
        Some(v3) => {
            let v4: Bytes = f82(v2.clone(), 0u64, v3);
            let v5: Bytes = f34(v2.clone(), {
                let a239 = v3;
                let a240 = 7u64;
                nat_add(a239, a240)?
            }, 0u64)?;
            if if f42(f82(v2, v3, 7u64), Bytes::lit(&[0x3a, 0x20, 0x66, 0x75, 0x6e, 0x63, 0x28])) {
                if f39(v4.clone())? {
                    f37(v5.clone(), Bytes::lit(&[0x3b]))?
                } else {
                    false
                }
            } else {
                false
            } {
                let m241 = f84(v5.clone(), Bytes::lit(&[0x29]), 0u64, f3(v5.clone()))?;
                match m241 {
                    None => {
                        Ok(Adt16::C1)
                    }
                    Some(v6) => {
                        let v7: Bytes = f34(v5.clone(), {
                            let a242 = v6;
                            let a243 = 1u64;
                            nat_add(a242, a243)?
                        }, 0u64)?;
                        let v8: bool = if f42(v7.clone(), Bytes::lit(&[0x3b])) {
                            true
                        } else {
                            if f33(v7.clone(), Bytes::lit(&[0x20, 0x2d, 0x3e, 0x20])) {
                                f39(f34(v7.clone(), 4u64, 1u64)?)?
                            } else {
                                false
                            }
                        };
                        if v8 {
                            let v9: Option<Str> = if f42(v7.clone(), Bytes::lit(&[0x3b])) {
                                None::<Str>
                            } else {
                                Some(f19(f34(v7, 4u64, 1u64)?))
                            };
                            let m244 = v9.clone();
                            match m244 {
                                None => {
                                    let m247 = f90(f82(v5, 0u64, v6))?;
                                    match m247 {
                                        Adt17::C0(v13) => {
                                            Ok(Adt16::C0(Adt15::C0(f33(v0, Bytes::lit(&[0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20])), Adt7::C0(f91(v4)?, v13, v9, v1))))
                                        }
                                        Adt17::C1(v14) => {
                                            Ok(Adt16::C2(v14))
                                        }
                                    }
                                }
                                Some(v10) => {
                                    if f88(v10.clone(), f89()) {
                                        let m245 = f90(f82(v5, 0u64, v6))?;
                                        match m245 {
                                            Adt17::C0(v11) => {
                                                Ok(Adt16::C0(Adt15::C0(f33(v0, Bytes::lit(&[0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20])), Adt7::C0(f91(v4)?, v11, v9, v1))))
                                            }
                                            Adt17::C1(v12) => {
                                                Ok(Adt16::C2(v12))
                                            }
                                        }
                                    } else {
                                        Ok(Adt16::C2(f92({
                                            let a246 = v10;
                                            utf8_encode(a246)
                                        })))
                                    }
                                }
                            }
                        } else {
                            Ok(Adt16::C1)
                        }
                    }
                }
            } else {
                Ok(Adt16::C1)
            }
        }
    }
}

pub fn f41(v0: u64, v1: Bytes) -> Adt14 {
    Adt14::C1(v0, v1, Str::lit(""))
}

pub fn f42(v0: Bytes, v1: Bytes) -> bool {
    let a252 = {
        let a248 = v0;
        let a249 = v1;
        compare_bytes(a248, a249)
    };
    let a253 = {
        let a250 = Bytes::lit(&[0x00]);
        let a251 = Bytes::lit(&[0x00]);
        compare_bytes(a250, a251)
    };
    equal(a252, a253)
}

pub fn f43(v0: Bytes, v1: Bytes, v2: u64, v3: Bytes, v4: u64) -> R<List<Bytes>> {
    let m254 = v4;
    if m254 == 0 {
        Ok(List::cons(v3, List::<Bytes>::nil()))
    } else {
        let v5 = m254 - 1;
        if f42(f82(v0.clone(), v2, 1u64), v1.clone()) {
            Ok(List::cons(v3, f43(v0, v1, {
                let a255 = v2;
                let a256 = 1u64;
                nat_add(a255, a256)?
            }, Bytes::lit(&[]), v5)?))
        } else {
            f43(v0.clone(), v1, {
                let a257 = v2;
                let a258 = 1u64;
                nat_add(a257, a258)?
            }, {
                let a259 = v3;
                let a260 = f82(v0, v2, 1u64);
                append_bytes(a259, a260)
            }, v5)
        }
    }
}

pub fn f44(v0: u64, v1: u64) -> Str {
    let m261 = v1;
    if m261 == 0 {
        Str::lit("")
    } else {
        let v2 = m261 - 1;
        let a262 = v0;
        let a263 = 10u64;
        if nat_lt(a262, a263) {
            f93(v0)
        } else {
            f5(List::cons(f44({
                let a264 = v0;
                let a265 = 10u64;
                let a266 = 0u64;
                nat_quot(a264, a265, a266)
            }, v2), List::cons(f93({
                let a267 = v0;
                let a268 = 10u64;
                let a269 = 0u64;
                nat_rem(a267, a268, a269)
            }), List::<Str>::nil())))
        }
    }
}

pub fn f45(v0: Str, v1: Bytes) -> R<Str> {
    Ok(f46({
        let a275 = {
            let a273 = v1.clone();
            let a274 = f94({
                let a270 = v0.clone();
                utf8_encode(a270)
            }, 0u64, v1.clone(), {
                let a272 = {
                    let a271 = v0.clone();
                    utf8_encode(a271)
                };
                length_bytes(a272)
            })?;
            append_bytes(a273, a274)
        };
        let a276 = v1;
        append_bytes(a275, a276)
    }, v0))
}

pub fn f46(v0: Bytes, v1: Str) -> Str {
    let m278 = {
        let a277 = v0;
        utf8_decode(a277)
    };
    match m278 {
        None => {
            v1
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f47(v0: List<Str>) -> R<bool> {
    let m279 = v0;
    match m279.uncons() {
        None => {
            Ok(false)
        }
        Some((v1, v2)) => {
            let a280 = v1;
            let a281 = Str::lit("memory");
            if equal(a280, a281) {
                let a282 = f50(v2)?;
                let a283 = 0u64;
                Ok(nat_eq(a282, a283))
            } else {
                Ok(false)
            }
        }
    }
}

pub fn f48(v0: List<Str>, v1: List<Str>) -> List<Str> {
    let m284 = v0;
    match m284.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v2, v3)) => {
            if f88(v2.clone(), v1.clone()) {
                f48(v3, v1)
            } else {
                List::cons(v2, f48(v3, v1))
            }
        }
    }
}

pub fn f49(v0: List<Adt7>) -> List<Str> {
    let m285 = v0;
    match m285.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(match v1 {
                Adt7::C0(h286, _, _, _) => {
                    h286
                }
            }, f49(v2))
        }
    }
}

pub fn f50(v0: List<Str>) -> R<u64> {
    let m287 = v0;
    match m287.uncons() {
        None => {
            Ok(0u64)
        }
        Some((_, v2)) => {
            let a288 = f50(v2)?;
            let a289 = 1u64;
            nat_add(a288, a289)
        }
    }
}

pub fn f51(v0: List<Adt7>) -> R<u64> {
    let m290 = v0;
    match m290.uncons() {
        None => {
            Ok(0u64)
        }
        Some((_, v2)) => {
            let a291 = f51(v2)?;
            let a292 = 1u64;
            nat_add(a291, a292)
        }
    }
}

pub fn f52(v0: Adt0, v1: Adt6, v2: Str) -> R<Adt4> {
    let v3: Str = f95(v2.clone())?;
    if f96(v3.clone())? {
        if f97(v0.clone())? {
            let m295 = f98(match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h293, _, _, _) => {
                    h293
                }
            }, List::cons(match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h294, _, _, _, _, _, _, _, _) => {
                    h294
                }
            }, List::cons(Str::lit("constructor"), List::<Str>::nil())))?;
            match m295 {
                None => {
                    let m297 = match v0.clone() {
                        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h296, _, _, _) => {
                            h296
                        }
                    };
                    match m297.uncons() {
                        None => {
                            Ok(f4(Str::lit("generate.model"), Str::lit("the model document has no operations")))
                        }
                        Some((_, _)) => {
                            f99(v0.clone(), v1, v2, v3, Adt10::C1(Adt11::C0(Str::lit("1"), match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h298, _, _, _, _, _, _, _, _) => {
                                    h298
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h299, _, _, _, _, _, _, _) => {
                                    h299
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h300, _, _, _, _, _, _) => {
                                    h300
                                }
                            }, f100(match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h301, _, _, _) => {
                                    h301
                                }
                            }), f101(v0))))
                        }
                    }
                }
                Some(v4) => {
                    Ok(f4(Str::lit("generate.model"), v4))
                }
            }
        } else {
            f99(v0, v1, v2, v3, Adt10::C0)
        }
    } else {
        Ok(f4(Str::lit("generate.model"), f5(List::cons(Str::lit("the application name "), List::cons(f18(v2)?, List::cons(Str::lit(" is not one generate can turn into a class name"), List::<Str>::nil()))))))
    }
}

pub fn f53(v0: Str) -> R<bool> {
    let v1: Bytes = {
        let a302 = v0;
        utf8_encode(a302)
    };
    let a306 = {
        let a304 = {
            let a303 = v1.clone();
            length_bytes(a303)
        };
        let a305 = 0u64;
        nat_eq(a304, a305)
    };
    if bool_not(a306) {
        let a307 = f102(f82(v1.clone(), 0u64, 1u64), f103(), 10u64);
        if bool_not(a307) {
            f104(v1.clone(), 0u64, {
                let a308 = v1;
                length_bytes(a308)
            })
        } else {
            Ok(false)
        }
    } else {
        Ok(false)
    }
}

pub fn f54(v0: Str) -> R<Str> {
    Ok(f46(f105({
        let a309 = v0.clone();
        utf8_encode(a309)
    }, 0u64, false, {
        let a311 = {
            let a310 = v0.clone();
            utf8_encode(a310)
        };
        length_bytes(a311)
    })?, v0))
}

pub fn f55(v0: Str, p318: List<(Str, Str)>) -> Option<Str> {
    let m317 = p318;
    {
        let mut m317 = m317;
        loop {
            let step = {
                let v1 = m317;
                let m312 = v1;
                match m312.uncons() {
                    None => {
                        Err::<List<(Str, Str)>, Option<Str>>(None::<Str>)
                    }
                    Some((v2, v3)) => {
                        let a314 = {
                            let (h313, _) = v2;
                            h313
                        };
                        let a315 = v0.clone();
                        if equal(a314, a315) {
                            Err::<List<(Str, Str)>, Option<Str>>(Some({
                                let (_, h316) = v2;
                                h316
                            }))
                        } else {
                            Ok::<List<(Str, Str)>, Option<Str>>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m317 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f56(v0: List<Str>) -> Str {
    let a321 = {
        let a319 = v0;
        let a320 = List::cons(Str::lit(""), List::<Str>::nil());
        append_list(a319, a320)
    };
    let a322 = Str::lit("\u{a}");
    join(a321, a322)
}

pub fn f57(v0: Str, v1: Str, v2: Str) -> Str {
    f5(List::cons(v0.clone(), List::cons(Str::lit(" Generated by `"), List::cons(v1.clone(), List::cons(Str::lit("` from "), List::cons(v2, List::cons(Str::lit(".\u{a}"), List::cons(v0, List::cons(Str::lit(" Do not edit: run `"), List::cons(v1, List::cons(Str::lit("` again.\u{a}"), List::<Str>::nil())))))))))))
}

pub fn f58(v0: Adt6) -> Str {
    f5(List::cons(Str::lit("the WIT world "), List::cons(match v0.clone() {
        Adt6::C0(h323, _, _, _, _, _, _, _, _) => {
            h323
        }
    }, List::cons(Str::lit(" ("), List::cons(match v0 {
        Adt6::C0(_, _, _, h324, _, _, _, _, _) => {
            h324
        }
    }, List::cons(Str::lit(")"), List::<Str>::nil()))))))
}

pub fn f59(v0: Str) -> R<Str> {
    f45(v0, Bytes::lit(&[0x27]))
}

pub fn f60(v0: List<(Str, Str)>) -> R<List<Str>> {
    let m325 = v0;
    match m325.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            Ok(List::cons(f5(List::cons(Str::lit("  "), List::cons({
                let (h326, _) = v1;
                h326
            }, List::cons(Str::lit(": "), List::cons(f59({
                let (_, h327) = v1;
                h327
            })?, List::cons(Str::lit(","), List::<Str>::nil())))))), f60(v2)?))
        }
    }
}

pub fn f61(v0: List<(Str, Str)>) -> List<(Str, Str)> {
    let m328 = v0;
    match m328.uncons() {
        None => {
            List::<(Str, Str)>::nil()
        }
        Some((v1, v2)) => {
            f106(v1, f61(v2))
        }
    }
}

pub fn f62(v0: List<Adt7>) -> List<(Str, Str)> {
    let m329 = v0;
    match m329.uncons() {
        None => {
            List::<(Str, Str)>::nil()
        }
        Some((v1, v2)) => {
            List::cons((match v1 {
                Adt7::C0(h330, _, _, _) => {
                    h330
                }
            }, Str::lit("function")), f62(v2))
        }
    }
}

pub fn f63(v0: List<Adt7>) -> R<List<Str>> {
    let m331 = v0;
    match m331.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            let a332 = f107(v1)?;
            let a333 = f63(v2)?;
            Ok(append_list(a332, a333))
        }
    }
}

pub fn f64() -> Str {
    Str::lit("/**\u{a} * Send one request to a fresh instance of the guest and return a copy of its response.\u{a} * The guest allocator never frees, so every request gets its own instance.\u{a} * @param {WebAssembly.Module} module\u{a} * @param {Uint8Array} request\u{a} * @returns {Uint8Array}\u{a} */\u{a}export function dispatch(module, request) {\u{a}  const guest = instantiate(module);\u{a}  const offset = guest.holoAlloc(request.length);\u{a}  new Uint8Array(guest.memory.buffer, offset, request.length).set(request);\u{a}  const packed = guest.holoRun(offset, request.length);\u{a}  const at = Number(packed >> 32n);\u{a}  const length = Number(packed & 0xffffffffn);\u{a}  if (at + length > guest.memory.buffer.byteLength) {\u{a}    throw new RangeError(`the guest answered ${length} bytes at ${at}, outside its memory`);\u{a}  }\u{a}  return new Uint8Array(guest.memory.buffer.slice(at, at + length));\u{a}}")
}

pub fn f65(v0: List<Adt7>) -> R<List<Str>> {
    let m334 = v0;
    match m334.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            let a335 = f108(v1)?;
            let a336 = f65(v2)?;
            Ok(append_list(a335, a336))
        }
    }
}

pub fn f66() -> Str {
    Str::lit("/**\u{a} * Send one request to a fresh instance of the guest and return a copy of its response.\u{a} * The guest allocator never frees, so every request gets its own instance.\u{a} */\u{a}export declare function dispatch(module: WebAssembly.Module, request: Uint8Array): Uint8Array;")
}

pub fn f67(v0: Adt9) -> Str {
    f5(List::cons(match v0.clone() {
        Adt9::C0(h337, _, _, _, _, _, _, _) => {
            h337
        }
    }, List::cons(Str::lit("'s model ("), List::cons(match v0.clone() {
        Adt9::C0(_, _, _, _, h338, _, _, _) => {
            h338
        }
    }, List::cons(Str::lit(", blake3:"), List::cons(match v0 {
        Adt9::C0(_, _, _, _, _, h339, _, _) => {
            h339
        }
    }, List::cons(Str::lit(")"), List::<Str>::nil())))))))
}

pub fn f68(v0: Adt9) -> R<Str> {
    Ok(f5(List::cons(Str::lit("/** The model this client was generated from. It equals `inputs.model` in prismpm.lock. */\u{a}export const MODEL = Object.freeze({\u{a}  name: "), List::cons(f59(match v0.clone() {
        Adt9::C0(h340, _, _, _, _, _, _, _) => {
            h340
        }
    })?, List::cons(Str::lit(",\u{a}  blake3: "), List::cons(f59(match v0.clone() {
        Adt9::C0(_, _, _, _, _, h341, _, _) => {
            h341
        }
    })?, List::cons(Str::lit(",\u{a}  sha256: "), List::cons(f59(match v0 {
        Adt9::C0(_, _, _, _, _, _, h342, _) => {
            h342
        }
    })?, List::cons(Str::lit(",\u{a}});"), List::<Str>::nil())))))))))
}

pub fn f69(v0: List<Str>) -> List<Str> {
    let m343 = v0;
    match m343.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(f109(f5(List::cons(Str::lit(" * "), List::cons(v1, List::<Str>::nil())))), f69(v2))
        }
    }
}

pub fn f70(v0: Adt9, v1: Str) -> List<Str> {
    let m345 = match v0 {
        Adt9::C0(_, _, _, h344, _, _, _, _) => {
            h344
        }
    };
    match m345 {
        None => {
            List::cons(v1, List::<Str>::nil())
        }
        Some(v2) => {
            List::cons(v1, List::cons(Str::lit(""), List::cons(v2, List::<Str>::nil())))
        }
    }
}

pub fn f71(v0: Str) -> Str {
    f5(List::cons(Str::lit("export class "), List::cons(v0.clone(), List::cons(Str::lit(" {\u{a}  #dispatch;\u{a}\u{a}  /** @param {(request: Uint8Array) => Uint8Array | Promise<Uint8Array>} dispatch */\u{a}  constructor(dispatch) {\u{a}    if (typeof dispatch !== 'function') throw new TypeError('"), List::cons(v0, List::cons(Str::lit(" needs a dispatch function');\u{a}    this.#dispatch = dispatch;\u{a}  }"), List::<Str>::nil()))))))
}

pub fn f72(v0: Adt9) -> R<Str> {
    Ok(f5(List::cons(Str::lit("/** The model this client was generated from. It equals `inputs.model` in prismpm.lock. */\u{a}export declare const MODEL: {\u{a}  readonly name: "), List::cons(f59(match v0 {
        Adt9::C0(h346, _, _, _, _, _, _, _) => {
            h346
        }
    })?, List::cons(Str::lit(";\u{a}  readonly blake3: string;\u{a}  readonly sha256: string;\u{a}};"), List::<Str>::nil())))))
}

pub fn f73(v0: Str, v1: List<Str>) -> List<Str> {
    let m347 = v1.clone();
    match m347.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v2, v3)) => {
            let m348 = v3;
            match m348.uncons() {
                None => {
                    List::cons(f5(List::cons(v0, List::cons(Str::lit("/** "), List::cons(v2, List::cons(Str::lit(" */"), List::<Str>::nil()))))), List::<Str>::nil())
                }
                Some((_, _)) => {
                    let a349 = List::cons(f5(List::cons(v0.clone(), List::cons(Str::lit("/**"), List::<Str>::nil()))), f110(v0.clone(), v1));
                    let a350 = List::cons(f5(List::cons(v0, List::cons(Str::lit(" */"), List::<Str>::nil()))), List::<Str>::nil());
                    append_list(a349, a350)
                }
            }
        }
    }
}

pub fn f74(v0: List<Adt12>) -> R<List<Str>> {
    let m351 = v0;
    match m351.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            Ok(List::cons(f59(match v1 {
                Adt12::C0(h352, _, _) => {
                    h352
                }
            })?, f74(v2)?))
        }
    }
}

pub fn f75(v0: Adt9, v1: Str, v2: List<Adt13>) -> R<List<Str>> {
    let m353 = v2;
    match m353.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v3, v4)) => {
            Ok(List::cons(f5(List::cons(Str::lit("  "), List::cons(if f111(match v3.clone() {
                Adt13::C0(h354, _) => {
                    h354
                }
            })? {
                match v3.clone() {
                    Adt13::C0(h355, _) => {
                        h355
                    }
                }
            } else {
                f59(match v3.clone() {
                    Adt13::C0(h356, _) => {
                        h356
                    }
                })?
            }, List::cons(Str::lit(": "), List::cons(f59(f112(v0.clone(), v1.clone(), v3))?, List::cons(Str::lit(","), List::<Str>::nil())))))), f75(v0, v1, v4)?))
        }
    }
}

pub fn f76(v0: List<Adt13>) -> Str {
    let m357 = v0;
    match m357.uncons() {
        None => {
            Str::lit("an error code")
        }
        Some((v1, _)) => {
            match v1 {
                Adt13::C0(h358, _) => {
                    h358
                }
            }
        }
    }
}

pub fn f77(v0: Str, v1: List<Adt12>) -> R<List<Str>> {
    let m359 = v1;
    match m359.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v2, v3)) => {
            Ok(List::cons(f5(List::cons(Str::lit("\u{a}  "), List::cons(f113(v0.clone(), v2.clone())?, List::cons(Str::lit("\u{a}  "), List::cons(f114(match v2.clone() {
                Adt12::C0(h360, _, _) => {
                    h360
                }
            })?, List::cons(Str::lit("(left, right) {\u{a}    return this."), List::cons(v0.clone(), List::cons(Str::lit("("), List::cons(f59(match v2 {
                Adt12::C0(h361, _, _) => {
                    h361
                }
            })?, List::cons(Str::lit(", left, right);\u{a}  }"), List::<Str>::nil())))))))))), f77(v0, v3)?))
        }
    }
}

pub fn f78(v0: List<Adt13>) -> R<List<Str>> {
    let m362 = v0;
    match m362.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            Ok(List::cons(f59(match v1 {
                Adt13::C0(h363, _) => {
                    h363
                }
            })?, f78(v2)?))
        }
    }
}

pub fn f79(v0: Str, v1: List<Adt12>) -> R<List<Str>> {
    let m364 = v1;
    match m364.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v2, v3)) => {
            Ok(List::cons(f5(List::cons(Str::lit("  "), List::cons(f113(v0.clone(), v2.clone())?, List::cons(Str::lit("\u{a}  "), List::cons(f114(match v2 {
                Adt12::C0(h365, _, _) => {
                    h365
                }
            })?, List::cons(Str::lit("(left: Int64, right: Int64): Promise<bigint>;"), List::<Str>::nil())))))), f79(v0, v3)?))
        }
    }
}

pub fn f80(v0: Bytes, p370: u64, p371: u64) -> R<u64> {
    let m369 = (p370, p371);
    {
        let mut m369 = m369;
        loop {
            let step = {
                let (v1, v2) = m369;
                let m366 = v2;
                if m366 == 0 {
                    Err::<(u64, u64), R<u64>>(Ok(v1))
                } else {
                    let v3 = m366 - 1;
                    if f115(f82(v0.clone(), v1, 1u64)) {
                        Ok::<(u64, u64), R<u64>>(({
                            let a367 = v1;
                            let a368 = 1u64;
                            nat_add(a367, a368)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<u64>>(Ok(v1))
                    }
                }
            };
            match step {
                Ok(next) => { m369 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f81(v0: Bytes, p378: u64, p379: u64, p380: u64) -> R<u64> {
    let m377 = (p378, (p379, p380));
    {
        let mut m377 = m377;
        loop {
            let step = {
                let (v1, (v2, v3)) = m377;
                let m372 = v2;
                if m372 == 0 {
                    Err::<(u64, (u64, u64)), R<u64>>(Ok(v3))
                } else {
                    let v4 = m372 - 1;
                    Ok::<(u64, (u64, u64)), R<u64>>(({
                        let a373 = v1;
                        let a374 = 1u64;
                        nat_add(a373, a374)?
                    }, (v4, if f115(f82(v0.clone(), v1, 1u64)) {
                        v3
                    } else {
                        let a375 = v1;
                        let a376 = 1u64;
                        nat_add(a375, a376)?
                    })))
                }
            };
            match step {
                Ok(next) => { m377 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f82(v0: Bytes, v1: u64, v2: u64) -> Bytes {
    let m384 = {
        let a381 = v0;
        let a382 = v1;
        let a383 = v2;
        slice_bytes(a381, a382, a383)
    };
    match m384 {
        None => {
            Bytes::lit(&[])
        }
        Some(v3) => {
            v3
        }
    }
}

pub fn f83(v0: u64, v1: u64) -> R<u64> {
    f116(v0, v1, 0u64, {
        let a385 = v0;
        let a386 = 1u64;
        nat_add(a385, a386)?
    })
}

pub fn f84(v0: Bytes, v1: Bytes, p391: u64, p392: u64) -> R<Option<u64>> {
    let m390 = (p391, p392);
    {
        let mut m390 = m390;
        loop {
            let step = {
                let (v2, v3) = m390;
                let m387 = v3;
                if m387 == 0 {
                    Err::<(u64, u64), R<Option<u64>>>(Ok(None::<u64>))
                } else {
                    let v4 = m387 - 1;
                    if f42(f82(v0.clone(), v2, 1u64), v1.clone()) {
                        Err::<(u64, u64), R<Option<u64>>>(Ok(Some(v2)))
                    } else {
                        Ok::<(u64, u64), R<Option<u64>>>(({
                            let a388 = v2;
                            let a389 = 1u64;
                            nat_add(a388, a389)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m390 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f85(v0: Bytes) -> R<bool> {
    let m393 = f84(v0.clone(), Bytes::lit(&[0x40]), 0u64, f3(v0.clone()))?;
    match m393 {
        None => {
            f39(v0)
        }
        Some(v1) => {
            if f39(f82(v0.clone(), 0u64, v1))? {
                let a398 = {
                    let a396 = f3(v0.clone());
                    let a397 = {
                        let a394 = v1;
                        let a395 = 1u64;
                        nat_add(a394, a395)?
                    };
                    nat_eq(a396, a397)
                };
                if bool_not(a398) {
                    f117(f34(v0.clone(), {
                        let a399 = v1;
                        let a400 = 1u64;
                        nat_add(a399, a400)?
                    }, 0u64)?, 0u64, f83(f3(v0), {
                        let a401 = v1;
                        let a402 = 1u64;
                        nat_add(a401, a402)?
                    })?)
                } else {
                    Ok(false)
                }
            } else {
                Ok(false)
            }
        }
    }
}

pub fn f86(v0: Bytes) -> bool {
    f102(v0, f118(), 26u64)
}

pub fn f87(v0: Bytes, p410: u64, p411: u64, p412: bool) -> R<bool> {
    let m409 = (p410, (p411, p412));
    {
        let mut m409 = m409;
        loop {
            let step = {
                let (v1, (v2, v3)) = m409;
                let m403 = v2;
                if m403 == 0 {
                    let a404 = v3;
                    Err::<(u64, (u64, bool)), R<bool>>(Ok(bool_not(a404)))
                } else {
                    let v4 = m403 - 1;
                    if f42(f82(v0.clone(), v1, 1u64), Bytes::lit(&[0x2d])) {
                        if v3 {
                            Err::<(u64, (u64, bool)), R<bool>>(Ok(false))
                        } else {
                            Ok::<(u64, (u64, bool)), R<bool>>(({
                                let a405 = v1;
                                let a406 = 1u64;
                                nat_add(a405, a406)?
                            }, (v4, true)))
                        }
                    } else {
                        if if f86(f82(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            f119(f82(v0.clone(), v1, 1u64))
                        } {
                            Ok::<(u64, (u64, bool)), R<bool>>(({
                                let a407 = v1;
                                let a408 = 1u64;
                                nat_add(a407, a408)?
                            }, (v4, false)))
                        } else {
                            Err::<(u64, (u64, bool)), R<bool>>(Ok(false))
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m409 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f88(v0: Str, p417: List<Str>) -> bool {
    let m416 = p417;
    {
        let mut m416 = m416;
        loop {
            let step = {
                let v1 = m416;
                let m413 = v1;
                match m413.uncons() {
                    None => {
                        Err::<List<Str>, bool>(false)
                    }
                    Some((v2, v3)) => {
                        let a414 = v2;
                        let a415 = v0.clone();
                        if equal(a414, a415) {
                            Err::<List<Str>, bool>(true)
                        } else {
                            Ok::<List<Str>, bool>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m416 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f89() -> List<Str> {
    List::cons(Str::lit("bool"), List::cons(Str::lit("u8"), List::cons(Str::lit("s8"), List::cons(Str::lit("u16"), List::cons(Str::lit("s16"), List::cons(Str::lit("u32"), List::cons(Str::lit("s32"), List::cons(Str::lit("char"), List::cons(Str::lit("u64"), List::cons(Str::lit("s64"), List::cons(Str::lit("f32"), List::cons(Str::lit("f64"), List::<Str>::nil()))))))))))))
}

pub fn f90(v0: Bytes) -> R<Adt17> {
    let a418 = f3(f32(v0.clone())?);
    let a419 = 0u64;
    if nat_eq(a418, a419) {
        Ok(Adt17::C0(List::<Adt8>::nil()))
    } else {
        f120(f16(v0, Bytes::lit(&[0x2c]))?)
    }
}

pub fn f91(v0: Bytes) -> R<Str> {
    Ok(f19(f121(v0.clone(), 0u64, f3(v0))?))
}

pub fn f92(v0: Bytes) -> Str {
    f5(List::cons(Str::lit("type "), List::cons(f19(v0), List::cons(Str::lit(" is outside the scalar subset generate reads"), List::<Str>::nil()))))
}

pub fn f93(v0: u64) -> Str {
    f46(f82(f103(), v0, 1u64), Str::lit("0"))
}

pub fn f94(v0: Bytes, v1: u64, v2: Bytes, v3: u64) -> R<Bytes> {
    let m420 = v3;
    if m420 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v4 = m420 - 1;
        let a425 = if f42(f82(v0.clone(), v1, 1u64), Bytes::lit(&[0x5c])) {
            Bytes::lit(&[0x5c, 0x5c])
        } else {
            if f42(f82(v0.clone(), v1, 1u64), v2.clone()) {
                let a421 = Bytes::lit(&[0x5c]);
                let a422 = v2.clone();
                append_bytes(a421, a422)
            } else {
                if f42(f82(v0.clone(), v1, 1u64), Bytes::lit(&[0x0a])) {
                    Bytes::lit(&[0x5c, 0x6e])
                } else {
                    f82(v0.clone(), v1, 1u64)
                }
            }
        };
        let a426 = f94(v0, {
            let a423 = v1;
            let a424 = 1u64;
            nat_add(a423, a424)?
        }, v2, v4)?;
        Ok(append_bytes(a425, a426))
    }
}

pub fn f95(v0: Str) -> R<Str> {
    Ok(f46(f122({
        let a427 = v0.clone();
        utf8_encode(a427)
    }, 0u64, true, {
        let a429 = {
            let a428 = v0.clone();
            utf8_encode(a428)
        };
        length_bytes(a429)
    })?, v0))
}

pub fn f96(v0: Str) -> R<bool> {
    let v1: Bytes = {
        let a430 = v0;
        utf8_encode(a430)
    };
    if f123(f82(v1.clone(), 0u64, 1u64)) {
        f124(v1.clone(), 0u64, f3(v1))
    } else {
        Ok(false)
    }
}

pub fn f97(v0: Adt0) -> R<bool> {
    let a432 = match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h431, _, _, _, _, _, _, _, _, _, _) => {
            h431
        }
    };
    let a433 = Str::lit("prismpm/model-document/1");
    if equal(a432, a433) {
        if f37({
            let a435 = match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h434, _, _, _, _, _, _, _, _, _) => {
                    h434
                }
            };
            utf8_encode(a435)
        }, Bytes::lit(&[0x41, 0x73, 0x63, 0x69, 0x69, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x49, 0x36, 0x34]))? {
            Ok(true)
        } else {
            f37({
                let a437 = match v0 {
                    Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h436, _, _, _, _, _, _, _, _, _) => {
                        h436
                    }
                };
                utf8_encode(a437)
            }, Bytes::lit(&[0x41, 0x73, 0x63, 0x69, 0x69, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x49, 0x6e, 0x74, 0x36, 0x34]))
        }
    } else {
        Ok(false)
    }
}

pub fn f98(p446: List<Adt1>, p447: List<Str>) -> R<Option<Str>> {
    let m445 = (p446, p447);
    {
        let mut m445 = m445;
        loop {
            let step = {
                let (v0, v1) = m445;
                let m438 = v0;
                match m438.uncons() {
                    None => {
                        Err::<(List<Adt1>, List<Str>), R<Option<Str>>>(Ok(None::<Str>))
                    }
                    Some((v2, v3)) => {
                        if f125(match v2.clone() {
                            Adt1::C0(h439, _, _) => {
                                h439
                            }
                        })? {
                            if f88(f114(match v2.clone() {
                                Adt1::C0(h440, _, _) => {
                                    h440
                                }
                            })?, v1.clone()) {
                                Err::<(List<Adt1>, List<Str>), R<Option<Str>>>(Ok(Some(f5(List::cons(Str::lit("operation "), List::cons(match v2.clone() {
                                    Adt1::C0(h441, _, _) => {
                                        h441
                                    }
                                }, List::cons(Str::lit(" collides with the method "), List::cons(f114(match v2 {
                                    Adt1::C0(h442, _, _) => {
                                        h442
                                    }
                                })?, List::<Str>::nil()))))))))
                            } else {
                                Ok::<(List<Adt1>, List<Str>), R<Option<Str>>>((v3, List::cons(f114(match v2 {
                                    Adt1::C0(h443, _, _) => {
                                        h443
                                    }
                                })?, v1)))
                            }
                        } else {
                            Err::<(List<Adt1>, List<Str>), R<Option<Str>>>(Ok(Some(f5(List::cons(Str::lit("operation "), List::cons(f18(match v2 {
                                Adt1::C0(h444, _, _) => {
                                    h444
                                }
                            })?, List::cons(Str::lit(" is not a request name generate can bind"), List::<Str>::nil())))))))
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m445 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f99(v0: Adt0, v1: Adt6, v2: Str, v3: Str, v4: Adt10) -> R<Adt4> {
    Ok(Adt4::C0(Adt5::C0(match v0.clone() {
        Adt0::C0(h448, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h448
        }
    }, v1, Adt9::C0(v2, v3.clone(), f126(v3)?, match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h449, _, _, _, _, _, _, _, _, _, _, _) => {
            h449
        }
    }, match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h450, _, _, _, _, _, _, _, _, _, _) => {
            h450
        }
    }, match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h451, _, _, _, _, _) => {
            h451
        }
    }, match v0 {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h452, _, _, _, _) => {
            h452
        }
    }, v4))))
}

pub fn f100(v0: List<Adt1>) -> List<Adt12> {
    let m453 = v0;
    match m453.uncons() {
        None => {
            List::<Adt12>::nil()
        }
        Some((v1, v2)) => {
            List::cons(Adt12::C0(match v1.clone() {
                Adt1::C0(h454, _, _) => {
                    h454
                }
            }, match v1.clone() {
                Adt1::C0(_, h455, _) => {
                    h455
                }
            }, match v1 {
                Adt1::C0(_, _, h456) => {
                    h456
                }
            }), f100(v2))
        }
    }
}

pub fn f101(v0: Adt0) -> List<Adt13> {
    List::cons(Adt13::C0(Str::lit("overflow"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h457, _, _) => {
            h457
        }
    }), List::cons(Adt13::C0(Str::lit("division-by-zero"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h458, _) => {
            h458
        }
    }), List::cons(Adt13::C0(Str::lit("malformed-request"), match v0 {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h459) => {
            h459
        }
    }), List::cons(Adt13::C0(Str::lit("unsupported-version"), None::<Str>), List::cons(Adt13::C0(Str::lit("unknown-operation"), None::<Str>), List::<Adt13>::nil())))))
}

pub fn f102(v0: Bytes, v1: Bytes, p462: u64) -> bool {
    let m461 = p462;
    {
        let mut m461 = m461;
        loop {
            let step = {
                let v2 = m461;
                let m460 = v2;
                if m460 == 0 {
                    Err::<u64, bool>(false)
                } else {
                    let v3 = m460 - 1;
                    if f42(f82(v1.clone(), v3, 1u64), v0.clone()) {
                        Err::<u64, bool>(true)
                    } else {
                        Ok::<u64, bool>(v3)
                    }
                }
            };
            match step {
                Ok(next) => { m461 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f103() -> Bytes {
    Bytes::lit(&[0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39])
}

pub fn f104(v0: Bytes, p467: u64, p468: u64) -> R<bool> {
    let m466 = (p467, p468);
    {
        let mut m466 = m466;
        loop {
            let step = {
                let (v1, v2) = m466;
                let m463 = v2;
                if m463 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m463 - 1;
                    if if f127(f82(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        f42(f82(v0.clone(), v1, 1u64), Bytes::lit(&[0x5f]))
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a464 = v1;
                            let a465 = 1u64;
                            nat_add(a464, a465)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m466 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f105(v0: Bytes, v1: u64, v2: bool, v3: u64) -> R<Bytes> {
    let m469 = v3;
    if m469 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v4 = m469 - 1;
        let v5: Bytes = f82(v0.clone(), v1, 1u64);
        if f42(v5.clone(), Bytes::lit(&[0x2d])) {
            let a472 = Bytes::lit(&[0x5f]);
            let a473 = f105(v0, {
                let a470 = v1;
                let a471 = 1u64;
                nat_add(a470, a471)?
            }, false, v4)?;
            Ok(append_bytes(a472, a473))
        } else {
            if f128(v5.clone()) {
                let a478 = if v2 {
                    let a474 = Bytes::lit(&[0x5f]);
                    let a475 = f129(v5);
                    append_bytes(a474, a475)
                } else {
                    f129(v5)
                };
                let a479 = f105(v0, {
                    let a476 = v1;
                    let a477 = 1u64;
                    nat_add(a476, a477)?
                }, false, v4)?;
                Ok(append_bytes(a478, a479))
            } else {
                let a482 = v5.clone();
                let a483 = f105(v0, {
                    let a480 = v1;
                    let a481 = 1u64;
                    nat_add(a480, a481)?
                }, f127(v5), v4)?;
                Ok(append_bytes(a482, a483))
            }
        }
    }
}

pub fn f106(v0: (Str, Str), v1: List<(Str, Str)>) -> List<(Str, Str)> {
    let m484 = v1;
    match m484.uncons() {
        None => {
            List::cons(v0, List::<(Str, Str)>::nil())
        }
        Some((v2, v3)) => {
            if f130({
                let (h485, _) = v0.clone();
                h485
            }, {
                let (h486, _) = v2.clone();
                h486
            }) {
                List::cons(v0, List::cons(v2, v3))
            } else {
                List::cons(v2, f106(v0, v3))
            }
        }
    }
}

pub fn f107(v0: Adt7) -> R<List<Str>> {
    let v1: Str = f5(List::cons(Str::lit("exports."), List::cons(match v0.clone() {
        Adt7::C0(h487, _, _, _) => {
            h487
        }
    }, List::cons(Str::lit("("), List::cons({
        let a489 = f131(match v0.clone() {
            Adt7::C0(_, h488, _, _) => {
                h488
            }
        });
        let a490 = Str::lit(", ");
        join(a489, a490)
    }, List::cons(Str::lit(")"), List::<Str>::nil()))))));
    let a498 = f73(Str::lit("    "), match v0.clone() {
        Adt7::C0(_, _, _, h491) => {
            h491
        }
    });
    let a499 = List::cons(f5(List::cons(Str::lit("    "), List::cons(f114(match v0.clone() {
        Adt7::C0(h492, _, _, _) => {
            h492
        }
    })?, List::cons(Str::lit(": ("), List::cons({
        let a494 = f132(match v0.clone() {
            Adt7::C0(_, h493, _, _) => {
                h493
            }
        });
        let a495 = Str::lit(", ");
        join(a494, a495)
    }, List::cons(Str::lit(") => "), List::cons({
        let m497 = match v0 {
            Adt7::C0(_, _, h496, _) => {
                h496
            }
        };
        match m497 {
            None => {
                f5(List::cons(Str::lit("void "), List::cons(v1, List::<Str>::nil())))
            }
            Some(v2) => {
                f133(v2, v1)
            }
        }
    }, List::cons(Str::lit(","), List::<Str>::nil())))))))), List::<Str>::nil());
    Ok(append_list(a498, a499))
}

pub fn f108(v0: Adt7) -> R<List<Str>> {
    let a507 = f73(Str::lit("  "), match v0.clone() {
        Adt7::C0(_, _, _, h500) => {
            h500
        }
    });
    let a508 = List::cons(f5(List::cons(Str::lit("  "), List::cons(f114(match v0.clone() {
        Adt7::C0(h501, _, _, _) => {
            h501
        }
    })?, List::cons(Str::lit("("), List::cons({
        let a503 = f134(match v0.clone() {
            Adt7::C0(_, h502, _, _) => {
                h502
            }
        });
        let a504 = Str::lit(", ");
        join(a503, a504)
    }, List::cons(Str::lit("): "), List::cons({
        let m506 = match v0 {
            Adt7::C0(_, _, h505, _) => {
                h505
            }
        };
        match m506 {
            None => {
                Str::lit("void")
            }
            Some(v1) => {
                f135(v1)
            }
        }
    }, List::cons(Str::lit(";"), List::<Str>::nil())))))))), List::<Str>::nil());
    Ok(append_list(a507, a508))
}

pub fn f109(v0: Str) -> Str {
    f46(f136({
        let a509 = v0.clone();
        utf8_encode(a509)
    }, {
        let a511 = {
            let a510 = v0.clone();
            utf8_encode(a510)
        };
        length_bytes(a511)
    }), v0)
}

pub fn f110(v0: Str, v1: List<Str>) -> List<Str> {
    let m512 = v1;
    match m512.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v2, v3)) => {
            List::cons(f109(f5(List::cons(v0.clone(), List::cons(Str::lit(" * "), List::cons(v2, List::<Str>::nil()))))), f110(v0, v3))
        }
    }
}

pub fn f111(v0: Str) -> R<bool> {
    let a513 = f114(v0.clone())?;
    let a514 = v0;
    Ok(equal(a513, a514))
}

pub fn f112(v0: Adt9, v1: Str, v2: Adt13) -> Str {
    let m516 = match v2.clone() {
        Adt13::C0(_, h515) => {
            h515
        }
    };
    match m516 {
        None => {
            let a518 = match v2.clone() {
                Adt13::C0(h517, _) => {
                    h517
                }
            };
            let a519 = Str::lit("unsupported-version");
            if equal(a518, a519) {
                f5(List::cons(match v0 {
                    Adt9::C0(h520, _, _, _, _, _, _, _) => {
                        h520
                    }
                }, List::cons(Str::lit(" does not answer request version "), List::cons(v1, List::cons(Str::lit("."), List::<Str>::nil())))))
            } else {
                let a522 = match v2.clone() {
                    Adt13::C0(h521, _) => {
                        h521
                    }
                };
                let a523 = Str::lit("unknown-operation");
                if equal(a522, a523) {
                    f5(List::cons(match v0 {
                        Adt9::C0(h524, _, _, _, _, _, _, _) => {
                            h524
                        }
                    }, List::cons(Str::lit(" does not know this operation."), List::<Str>::nil())))
                } else {
                    f5(List::cons(match v0 {
                        Adt9::C0(h525, _, _, _, _, _, _, _) => {
                            h525
                        }
                    }, List::cons(Str::lit(" refused the request: "), List::cons(match v2 {
                        Adt13::C0(h526, _) => {
                            h526
                        }
                    }, List::cons(Str::lit("."), List::<Str>::nil())))))
                }
            }
        }
        Some(v3) => {
            v3
        }
    }
}

pub fn f113(v0: Str, v1: Adt12) -> R<Str> {
    Ok(f5(List::cons(Str::lit("/** "), List::cons(match v1.clone() {
        Adt12::C0(_, h527, _) => {
            h527
        }
    }, List::cons(Str::lit(": `"), List::cons(v0, List::cons(Str::lit("("), List::cons(f59(match v1 {
        Adt12::C0(h528, _, _) => {
            h528
        }
    })?, List::cons(Str::lit(", left, right)`. */"), List::<Str>::nil())))))))))
}

pub fn f114(v0: Str) -> R<Str> {
    Ok(f46(f122({
        let a529 = v0.clone();
        utf8_encode(a529)
    }, 0u64, false, {
        let a531 = {
            let a530 = v0.clone();
            utf8_encode(a530)
        };
        length_bytes(a531)
    })?, v0))
}

pub fn f115(v0: Bytes) -> bool {
    f102(v0, Bytes::lit(&[0x20, 0x09, 0x0d]), 3u64)
}

pub fn f116(v0: u64, v1: u64, p540: u64, p541: u64) -> R<u64> {
    let m539 = (p540, p541);
    {
        let mut m539 = m539;
        loop {
            let step = {
                let (v2, v3) = m539;
                let m532 = v3;
                if m532 == 0 {
                    Err::<(u64, u64), R<u64>>(Ok(0u64))
                } else {
                    let v4 = m532 - 1;
                    let a535 = {
                        let a533 = v2;
                        let a534 = v1;
                        nat_add(a533, a534)?
                    };
                    let a536 = v0;
                    if nat_eq(a535, a536) {
                        Err::<(u64, u64), R<u64>>(Ok(v2))
                    } else {
                        Ok::<(u64, u64), R<u64>>(({
                            let a537 = v2;
                            let a538 = 1u64;
                            nat_add(a537, a538)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m539 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f117(v0: Bytes, p546: u64, p547: u64) -> R<bool> {
    let m545 = (p546, p547);
    {
        let mut m545 = m545;
        loop {
            let step = {
                let (v1, v2) = m545;
                let m542 = v2;
                if m542 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m542 - 1;
                    if if f86(f82(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        if f123(f82(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            if f119(f82(v0.clone(), v1, 1u64)) {
                                true
                            } else {
                                f102(f82(v0.clone(), v1, 1u64), Bytes::lit(&[0x2e, 0x2b, 0x2d]), 3u64)
                            }
                        }
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a543 = v1;
                            let a544 = 1u64;
                            nat_add(a543, a544)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m545 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f118() -> Bytes {
    Bytes::lit(&[0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a])
}

pub fn f119(v0: Bytes) -> bool {
    f102(v0, f103(), 10u64)
}

pub fn f120(v0: List<Bytes>) -> R<Adt17> {
    let m548 = v0;
    match m548.uncons() {
        None => {
            Ok(Adt17::C0(List::<Adt8>::nil()))
        }
        Some((v1, v2)) => {
            let v3: Bytes = f32(v1)?;
            let m549 = f84(v3.clone(), Bytes::lit(&[0x3a]), 0u64, f3(v3.clone()))?;
            match m549 {
                None => {
                    Ok(Adt17::C1(f5(List::cons(Str::lit("cannot read parameter "), List::cons(f18(f19(v3))?, List::<Str>::nil())))))
                }
                Some(v4) => {
                    let v5: Bytes = f82(v3.clone(), 0u64, v4);
                    let v6: Bytes = f34(v3.clone(), {
                        let a550 = v4;
                        let a551 = 2u64;
                        nat_add(a550, a551)?
                    }, 0u64)?;
                    if if f42(f82(v3.clone(), {
                        let a552 = v4;
                        let a553 = 1u64;
                        nat_add(a552, a553)?
                    }, 1u64), Bytes::lit(&[0x20])) {
                        if f39(v5.clone())? {
                            f39(v6.clone())?
                        } else {
                            false
                        }
                    } else {
                        false
                    } {
                        if f88(f19(v6.clone()), f89()) {
                            let m554 = f120(v2)?;
                            match m554 {
                                Adt17::C0(v7) => {
                                    Ok(Adt17::C0(List::cons(Adt8::C0(f19(v5), f19(v6)), v7)))
                                }
                                Adt17::C1(v8) => {
                                    Ok(Adt17::C1(v8))
                                }
                            }
                        } else {
                            Ok(Adt17::C1(f92(v6)))
                        }
                    } else {
                        Ok(Adt17::C1(f5(List::cons(Str::lit("cannot read parameter "), List::cons(f18(f19(v3))?, List::<Str>::nil())))))
                    }
                }
            }
        }
    }
}

pub fn f121(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let m555 = v2;
    if m555 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v3 = m555 - 1;
        let a558 = if f42(f82(v0.clone(), v1, 1u64), Bytes::lit(&[0x2d])) {
            Bytes::lit(&[0x5f])
        } else {
            f82(v0.clone(), v1, 1u64)
        };
        let a559 = f121(v0, {
            let a556 = v1;
            let a557 = 1u64;
            nat_add(a556, a557)?
        }, v3)?;
        Ok(append_bytes(a558, a559))
    }
}

pub fn f122(v0: Bytes, v1: u64, v2: bool, v3: u64) -> R<Bytes> {
    let m560 = v3;
    if m560 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v4 = m560 - 1;
        if f137(f82(v0.clone(), v1, 1u64)) {
            f122(v0, {
                let a561 = v1;
                let a562 = 1u64;
                nat_add(a561, a562)?
            }, true, v4)
        } else {
            let a565 = if v2 {
                f138(f82(v0.clone(), v1, 1u64))
            } else {
                f82(v0.clone(), v1, 1u64)
            };
            let a566 = f122(v0, {
                let a563 = v1;
                let a564 = 1u64;
                nat_add(a563, a564)?
            }, false, v4)?;
            Ok(append_bytes(a565, a566))
        }
    }
}

pub fn f123(v0: Bytes) -> bool {
    f102(v0, f139(), 26u64)
}

pub fn f124(v0: Bytes, p571: u64, p572: u64) -> R<bool> {
    let m570 = (p571, p572);
    {
        let mut m570 = m570;
        loop {
            let step = {
                let (v1, v2) = m570;
                let m567 = v2;
                if m567 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m567 - 1;
                    if if f86(f82(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        if f123(f82(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            f119(f82(v0.clone(), v1, 1u64))
                        }
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a568 = v1;
                            let a569 = 1u64;
                            nat_add(a568, a569)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m570 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f125(v0: Str) -> R<bool> {
    let v1: Bytes = {
        let a573 = v0;
        utf8_encode(a573)
    };
    if f86(f82(v1.clone(), 0u64, 1u64)) {
        f140(v1.clone(), 0u64, f3(v1))
    } else {
        Ok(false)
    }
}

pub fn f126(v0: Str) -> R<Str> {
    Ok(f46(f141({
        let a574 = v0.clone();
        utf8_encode(a574)
    }, 0u64, {
        let a576 = {
            let a575 = v0.clone();
            utf8_encode(a575)
        };
        length_bytes(a576)
    })?, v0))
}

pub fn f127(v0: Bytes) -> bool {
    if f102(v0.clone(), f118(), 26u64) {
        true
    } else {
        f102(v0, f103(), 10u64)
    }
}

pub fn f128(v0: Bytes) -> bool {
    let a577 = f42(f129(v0.clone()), v0);
    bool_not(a577)
}

pub fn f129(v0: Bytes) -> Bytes {
    f142(v0, f139(), f118(), 26u64)
}

pub fn f130(v0: Str, v1: Str) -> bool {
    let a584 = {
        let a580 = {
            let a578 = v0;
            utf8_encode(a578)
        };
        let a581 = {
            let a579 = v1;
            utf8_encode(a579)
        };
        compare_bytes(a580, a581)
    };
    let a585 = {
        let a582 = Bytes::lit(&[0x00]);
        let a583 = Bytes::lit(&[0x01]);
        compare_bytes(a582, a583)
    };
    equal(a584, a585)
}

pub fn f131(v0: List<Adt8>) -> List<Str> {
    let m586 = v0;
    match m586.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons({
                let a588 = match v1.clone() {
                    Adt8::C0(_, h587) => {
                        h587
                    }
                };
                let a589 = Str::lit("bool");
                if equal(a588, a589) {
                    f5(List::cons(match v1 {
                        Adt8::C0(h590, _) => {
                            h590
                        }
                    }, List::cons(Str::lit(" ? 1 : 0"), List::<Str>::nil())))
                } else {
                    match v1 {
                        Adt8::C0(h591, _) => {
                            h591
                        }
                    }
                }
            }, f131(v2))
        }
    }
}

pub fn f132(v0: List<Adt8>) -> List<Str> {
    let m592 = v0;
    match m592.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(match v1 {
                Adt8::C0(h593, _) => {
                    h593
                }
            }, f132(v2))
        }
    }
}

pub fn f133(v0: Str, v1: Str) -> Str {
    let a594 = v0.clone();
    let a595 = Str::lit("bool");
    if equal(a594, a595) {
        f5(List::cons(v1, List::cons(Str::lit(" !== 0"), List::<Str>::nil())))
    } else {
        let a596 = v0.clone();
        let a597 = Str::lit("u8");
        if if equal(a596, a597) {
            true
        } else {
            let a598 = v0.clone();
            let a599 = Str::lit("u16");
            if equal(a598, a599) {
                true
            } else {
                let a600 = v0.clone();
                let a601 = Str::lit("u32");
                if equal(a600, a601) {
                    true
                } else {
                    let a602 = v0.clone();
                    let a603 = Str::lit("char");
                    equal(a602, a603)
                }
            }
        } {
            f5(List::cons(v1, List::cons(Str::lit(" >>> 0"), List::<Str>::nil())))
        } else {
            let a604 = v0.clone();
            let a605 = Str::lit("s8");
            if if equal(a604, a605) {
                true
            } else {
                let a606 = v0.clone();
                let a607 = Str::lit("s16");
                if equal(a606, a607) {
                    true
                } else {
                    let a608 = v0.clone();
                    let a609 = Str::lit("s32");
                    equal(a608, a609)
                }
            } {
                f5(List::cons(v1, List::cons(Str::lit(" | 0"), List::<Str>::nil())))
            } else {
                let a610 = v0.clone();
                let a611 = Str::lit("u64");
                if equal(a610, a611) {
                    f5(List::cons(Str::lit("BigInt.asUintN(64, "), List::cons(v1, List::cons(Str::lit(")"), List::<Str>::nil()))))
                } else {
                    let a612 = v0;
                    let a613 = Str::lit("s64");
                    if equal(a612, a613) {
                        f5(List::cons(Str::lit("BigInt.asIntN(64, "), List::cons(v1, List::cons(Str::lit(")"), List::<Str>::nil()))))
                    } else {
                        v1
                    }
                }
            }
        }
    }
}

pub fn f134(v0: List<Adt8>) -> List<Str> {
    let m614 = v0;
    match m614.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(f5(List::cons(match v1.clone() {
                Adt8::C0(h615, _) => {
                    h615
                }
            }, List::cons(Str::lit(": "), List::cons(f135(match v1 {
                Adt8::C0(_, h616) => {
                    h616
                }
            }), List::<Str>::nil())))), f134(v2))
        }
    }
}

pub fn f135(v0: Str) -> Str {
    let a617 = v0.clone();
    let a618 = Str::lit("bool");
    if equal(a617, a618) {
        Str::lit("boolean")
    } else {
        let a619 = v0.clone();
        let a620 = Str::lit("u64");
        if if equal(a619, a620) {
            true
        } else {
            let a621 = v0;
            let a622 = Str::lit("s64");
            equal(a621, a622)
        } {
            Str::lit("bigint")
        } else {
            Str::lit("number")
        }
    }
}

pub fn f136(p625: Bytes, p626: u64) -> Bytes {
    let m624 = (p625, p626);
    {
        let mut m624 = m624;
        loop {
            let step = {
                let (v0, v1) = m624;
                let m623 = v1;
                if m623 == 0 {
                    Err::<(Bytes, u64), Bytes>(Bytes::lit(&[]))
                } else {
                    let v2 = m623 - 1;
                    if f42(f82(v0.clone(), v2, 1u64), Bytes::lit(&[0x20])) {
                        Ok::<(Bytes, u64), Bytes>((f82(v0, 0u64, v2), v2))
                    } else {
                        Err::<(Bytes, u64), Bytes>(v0)
                    }
                }
            };
            match step {
                Ok(next) => { m624 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f137(v0: Bytes) -> bool {
    if f42(v0.clone(), Bytes::lit(&[0x2d])) {
        true
    } else {
        f42(v0, Bytes::lit(&[0x5f]))
    }
}

pub fn f138(v0: Bytes) -> Bytes {
    f142(v0, f118(), f139(), 26u64)
}

pub fn f139() -> Bytes {
    Bytes::lit(&[0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a])
}

pub fn f140(v0: Bytes, p631: u64, p632: u64) -> R<bool> {
    let m630 = (p631, p632);
    {
        let mut m630 = m630;
        loop {
            let step = {
                let (v1, v2) = m630;
                let m627 = v2;
                if m627 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m627 - 1;
                    if if f86(f82(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        if f119(f82(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            f42(f82(v0.clone(), v1, 1u64), Bytes::lit(&[0x2d]))
                        }
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a628 = v1;
                            let a629 = 1u64;
                            nat_add(a628, a629)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m630 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f141(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let m633 = v2;
    if m633 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v3 = m633 - 1;
        if f128(f82(v0.clone(), v1, 1u64)) {
            let a640 = {
                let a634 = v1;
                let a635 = 0u64;
                if nat_eq(a634, a635) {
                    f129(f82(v0.clone(), v1, 1u64))
                } else {
                    let a636 = Bytes::lit(&[0x2d]);
                    let a637 = f129(f82(v0.clone(), v1, 1u64));
                    append_bytes(a636, a637)
                }
            };
            let a641 = f141(v0, {
                let a638 = v1;
                let a639 = 1u64;
                nat_add(a638, a639)?
            }, v3)?;
            Ok(append_bytes(a640, a641))
        } else {
            let a644 = f82(v0.clone(), v1, 1u64);
            let a645 = f141(v0, {
                let a642 = v1;
                let a643 = 1u64;
                nat_add(a642, a643)?
            }, v3)?;
            Ok(append_bytes(a644, a645))
        }
    }
}

pub fn f142(v0: Bytes, v1: Bytes, v2: Bytes, p648: u64) -> Bytes {
    let m647 = p648;
    {
        let mut m647 = m647;
        loop {
            let step = {
                let v3 = m647;
                let m646 = v3;
                if m646 == 0 {
                    Err::<u64, Bytes>(v0.clone())
                } else {
                    let v4 = m646 - 1;
                    if f42(f82(v1.clone(), v4, 1u64), v0.clone()) {
                        Err::<u64, Bytes>(f82(v2.clone(), v4, 1u64))
                    } else {
                        Ok::<u64, Bytes>(v4)
                    }
                }
            };
            match step {
                Ok(next) => { m647 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn run(p0: Adt0) -> R<Adt2> {
    f0(p0)
}
