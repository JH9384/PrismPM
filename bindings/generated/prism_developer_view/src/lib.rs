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
    C0(List<Adt1>, List<Adt2>),
}

#[derive(Clone)]
pub enum Adt1 {
    C0(Str, Str, Str),
}

#[derive(Clone)]
pub enum Adt2 {
    C0(Str, Str, Str, Str),
}

#[derive(Clone)]
pub enum Adt3 {
    C0(List<Str>, Str),
}

#[derive(Clone)]
pub enum Adt4 {
    C0(Str, Str, Str, Str),
}

pub fn f0(v0: Adt0) -> R<Adt3> {
    Ok(Adt3::C0({
        let a7 = f1(match v0.clone() {
            Adt0::C0(h1, _) => {
                h1
            }
        })?;
        let a8 = {
            let a5 = f2(match v0.clone() {
                Adt0::C0(_, h2) => {
                    h2
                }
            }, match v0.clone() {
                Adt0::C0(h3, _) => {
                    h3
                }
            });
            let a6 = f3(f4(), match v0 {
                Adt0::C0(_, h4) => {
                    h4
                }
            });
            append_list(a5, a6)
        };
        append_list(a7, a8)
    }, f5()))
}

pub fn f1(v0: List<Adt1>) -> R<List<Str>> {
    let m9 = v0;
    match m9.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            let a12 = {
                let a10 = f6(v1.clone());
                let a11 = f7(v1)?;
                append_list(a10, a11)
            };
            let a13 = f1(v2)?;
            Ok(append_list(a12, a13))
        }
    }
}

pub fn f2(v0: List<Adt2>, v1: List<Adt1>) -> List<Str> {
    let m14 = v0;
    match m14.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v2, v3)) => {
            let a18 = if f8(v2.clone(), f4()) {
                if f9(match v2.clone() {
                    Adt2::C0(h15, _, _, _) => {
                        h15
                    }
                }, match v2.clone() {
                    Adt2::C0(_, _, h16, _) => {
                        h16
                    }
                }, v1.clone()) {
                    List::<Str>::nil()
                } else {
                    f10(f11(List::cons(f12(v2.clone()), List::cons(Str::lit(" names a "), List::cons(match v2 {
                        Adt2::C0(h17, _, _, _) => {
                            h17
                        }
                    }, List::cons(Str::lit(" the surface does not have"), List::<Str>::nil()))))))
                }
            } else {
                f10(f11(List::cons(f12(v2), List::cons(Str::lit(" is not declared in the developer view"), List::<Str>::nil()))))
            };
            let a19 = f2(v3, v1);
            append_list(a18, a19)
        }
    }
}

pub fn f3(v0: List<Adt2>, v1: List<Adt2>) -> List<Str> {
    let m20 = v0;
    match m20.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v2, v3)) => {
            let a21 = if f8(v2.clone(), v1.clone()) {
                List::<Str>::nil()
            } else {
                f10(f11(List::cons(f12(v2), List::cons(Str::lit(" is declared, and the surface does not keep it"), List::<Str>::nil()))))
            };
            let a22 = f3(v3, v1);
            append_list(a21, a22)
        }
    }
}

pub fn f4() -> List<Adt2> {
    List::cons(f13(Str::lit("verb"), Str::lit("history"), Str::lit("record"), Str::lit("0.9.0")), List::cons(f13(Str::lit("flag"), Str::lit("holo"), Str::lit("image"), Str::lit("0.9.0")), List::<Adt2>::nil()))
}

pub fn f5() -> Str {
    f14({
        let a33 = List::cons(Str::lit("# Developer view glossary"), List::cons(Str::lit(""), List::cons(Str::lit("The developer view of #346: the words of the `prism-code` CLI, its SDK namespaces and their developer docs, each mapped onto the canonical term of the model, which does not change."), List::cons(Str::lit("Generated from `bindings/src/Foundation/Views/V1/Developer.lex.tex` by `cargo xtask check-developer-view --write`; edit the model, not this file."), List::cons(Str::lit(""), List::cons(Str::lit("A Docker word is used only for its Docker meaning. Where Docker has a behaviour Prism lacks, the word waits for the issue that builds it."), List::cons(Str::lit(""), List::cons(Str::lit("| Developer view | Kind | Canonical term | Available |"), List::cons(Str::lit("|---|---|---|---|"), List::<Str>::nil())))))))));
        let a34 = {
            let a31 = f15(f16());
            let a32 = {
                let a29 = List::cons(Str::lit(""), List::cons(Str::lit("## Other words of the surface"), List::cons(Str::lit(""), List::cons(Str::lit("Docker's own verbs and the terms that are new with Prism (verify, proof, replay, world) keep their names."), List::<Str>::nil()))));
                let a30 = {
                    let a27 = List::cons(Str::lit(""), List::cons({
                        let a23 = f17(f18());
                        let a24 = Str::lit(", ");
                        join(a23, a24)
                    }, List::<Str>::nil()));
                    let a28 = {
                        let a25 = List::cons(Str::lit(""), List::cons(Str::lit("## Deprecated aliases"), List::cons(Str::lit(""), List::cons(Str::lit("Each alias prints one warning that names the new term, and is removed in the release shown."), List::cons(Str::lit(""), List::cons(Str::lit("| Kind | Old | New | Removed in |"), List::cons(Str::lit("|---|---|---|---|"), List::<Str>::nil())))))));
                        let a26 = f19(f4());
                        append_list(a25, a26)
                    };
                    append_list(a27, a28)
                };
                append_list(a29, a30)
            };
            append_list(a31, a32)
        };
        append_list(a33, a34)
    })
}

pub fn f6(v0: Adt1) -> List<Str> {
    if f20(match v0.clone() {
        Adt1::C0(h35, _, _) => {
            h35
        }
    }, Str::lit("flag")) {
        List::<Str>::nil()
    } else {
        let m38 = f21(match v0.clone() {
            Adt1::C0(_, _, h36) => {
                h36
            }
        }, if f20(match v0.clone() {
            Adt1::C0(h37, _, _) => {
                h37
            }
        }, Str::lit("namespace")) {
            Str::lit("noun")
        } else {
            Str::lit("verb")
        }, f16());
        match m38 {
            None => {
                if f22(match v0.clone() {
                    Adt1::C0(_, _, h42) => {
                        h42
                    }
                }, f18()) {
                    List::<Str>::nil()
                } else {
                    f10(f11(List::cons(match v0 {
                        Adt1::C0(_, h43, _) => {
                            h43
                        }
                    }, List::cons(Str::lit(" is not a word of the developer view; declare it in the glossary or rename it"), List::<Str>::nil()))))
                }
            }
            Some(v1) => {
                if f20(match v1.clone() {
                    Adt4::C0(_, _, _, h39) => {
                        h39
                    }
                }, Str::lit("now")) {
                    List::<Str>::nil()
                } else {
                    f10(f11(List::cons(match v0 {
                        Adt1::C0(_, h40, _) => {
                            h40
                        }
                    }, List::cons(Str::lit(" takes a Docker word before Prism has its behaviour, which "), List::cons(match v1 {
                        Adt4::C0(_, _, _, h41) => {
                            h41
                        }
                    }, List::cons(Str::lit(" builds"), List::<Str>::nil()))))))
                }
            }
        }
    }
}

pub fn f7(v0: Adt1) -> R<List<Str>> {
    let m45 = f23(f24(match v0.clone() {
        Adt1::C0(_, _, h44) => {
            h44
        }
    })?);
    match m45 {
        None => {
            Ok(List::<Str>::nil())
        }
        Some(v1) => {
            Ok(f10(f11(List::cons(match v0 {
                Adt1::C0(_, h46, _) => {
                    h46
                }
            }, List::cons(Str::lit(" uses the canonical term "), List::cons({
                let (h47, _) = v1;
                h47
            }, List::cons(Str::lit(", which the developer view calls "), List::cons({
                let (_, h48) = v1;
                h48
            }, List::<Str>::nil()))))))))
        }
    }
}

pub fn f8(v0: Adt2, p51: List<Adt2>) -> bool {
    let m50 = p51;
    {
        let mut m50 = m50;
        loop {
            let step = {
                let v1 = m50;
                let m49 = v1;
                match m49.uncons() {
                    None => {
                        Err::<List<Adt2>, bool>(false)
                    }
                    Some((v2, v3)) => {
                        if f25(v0.clone(), v2) {
                            Err::<List<Adt2>, bool>(true)
                        } else {
                            Ok::<List<Adt2>, bool>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m50 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f9(v0: Str, v1: Str, p56: List<Adt1>) -> bool {
    let m55 = p56;
    {
        let mut m55 = m55;
        loop {
            let step = {
                let v2 = m55;
                let m52 = v2;
                match m52.uncons() {
                    None => {
                        Err::<List<Adt1>, bool>(false)
                    }
                    Some((v3, v4)) => {
                        if if f20(match v3.clone() {
                            Adt1::C0(h53, _, _) => {
                                h53
                            }
                        }, v0.clone()) {
                            f20(match v3 {
                                Adt1::C0(_, _, h54) => {
                                    h54
                                }
                            }, v1.clone())
                        } else {
                            false
                        } {
                            Err::<List<Adt1>, bool>(true)
                        } else {
                            Ok::<List<Adt1>, bool>(v4)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m55 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f10(v0: Str) -> List<Str> {
    List::cons(v0, List::<Str>::nil())
}

pub fn f11(v0: List<Str>) -> Str {
    let a57 = v0;
    let a58 = Str::lit("");
    join(a57, a58)
}

pub fn f12(v0: Adt2) -> Str {
    f11(List::cons(Str::lit("the "), List::cons(match v0.clone() {
        Adt2::C0(h59, _, _, _) => {
            h59
        }
    }, List::cons(Str::lit(" alias "), List::cons(match v0.clone() {
        Adt2::C0(_, h60, _, _) => {
            h60
        }
    }, List::cons(Str::lit(" for "), List::cons(match v0.clone() {
        Adt2::C0(_, _, h61, _) => {
            h61
        }
    }, List::cons(Str::lit(" (removed in "), List::cons(match v0 {
        Adt2::C0(_, _, _, h62) => {
            h62
        }
    }, List::cons(Str::lit(")"), List::<Str>::nil()))))))))))
}

pub fn f13(v0: Str, v1: Str, v2: Str, v3: Str) -> Adt2 {
    Adt2::C0(v0, v1, v2, v3)
}

pub fn f14(v0: List<Str>) -> Str {
    let a65 = {
        let a63 = v0;
        let a64 = List::cons(Str::lit(""), List::<Str>::nil());
        append_list(a63, a64)
    };
    let a66 = Str::lit("\u{a}");
    join(a65, a66)
}

pub fn f15(v0: List<Adt4>) -> List<Str> {
    let m67 = v0;
    match m67.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(f11(List::cons(Str::lit("| `"), List::cons(match v1.clone() {
                Adt4::C0(h68, _, _, _) => {
                    h68
                }
            }, List::cons(Str::lit("` | "), List::cons(match v1.clone() {
                Adt4::C0(_, h69, _, _) => {
                    h69
                }
            }, List::cons(Str::lit(" | "), List::cons(match v1.clone() {
                Adt4::C0(_, _, h70, _) => {
                    h70
                }
            }, List::cons(Str::lit(" | "), List::cons(f26(match v1 {
                Adt4::C0(_, _, _, h71) => {
                    h71
                }
            }), List::cons(Str::lit(" |"), List::<Str>::nil())))))))))), f15(v2))
        }
    }
}

pub fn f16() -> List<Adt4> {
    List::cons(f27(Str::lit("image"), Str::lit("noun"), Str::lit("holo"), Str::lit("now")), List::cons(f27(Str::lit("digest"), Str::lit("noun"), Str::lit("archive fingerprint"), Str::lit("now")), List::cons(f27(Str::lit("layer digest"), Str::lit("noun"), Str::lit("section fingerprint"), Str::lit("now")), List::cons(f27(Str::lit("config"), Str::lit("noun"), Str::lit("model document"), Str::lit("now")), List::cons(f27(Str::lit("manifest"), Str::lit("noun"), Str::lit("product release"), Str::lit("now")), List::cons(f27(Str::lit("builder image"), Str::lit("noun"), Str::lit("SDK image"), Str::lit("now")), List::cons(f27(Str::lit("container"), Str::lit("noun"), Str::lit("instance"), Str::lit("now")), List::cons(f27(Str::lit("recording"), Str::lit("noun"), Str::lit("history"), Str::lit("now")), List::cons(f27(Str::lit("network"), Str::lit("noun"), Str::lit("outbound capability grant"), Str::lit("now")), List::cons(f27(Str::lit("volume"), Str::lit("noun"), Str::lit("store capability grant"), Str::lit("now")), List::cons(f27(Str::lit("run"), Str::lit("verb"), Str::lit("instantiate and dispatch, one shot"), Str::lit("now")), List::cons(f27(Str::lit("rm"), Str::lit("verb"), Str::lit("remove an exited instance"), Str::lit("now")), List::cons(f27(Str::lit("record"), Str::lit("verb"), Str::lit("write the acceptance vectors as a history"), Str::lit("now")), List::cons(f27(Str::lit("ps"), Str::lit("verb"), Str::lit("list running instances"), Str::lit("now")), List::cons(f27(Str::lit("stop"), Str::lit("verb"), Str::lit("stop a running instance"), Str::lit("#350")), List::cons(f27(Str::lit("logs"), Str::lit("verb"), Str::lit("read an instance's output"), Str::lit("now")), List::cons(f27(Str::lit("ls"), Str::lit("verb"), Str::lit("list the store capability grants"), Str::lit("now")), List::cons(f27(Str::lit("images"), Str::lit("verb"), Str::lit("list the local store"), Str::lit("now")), List::cons(f27(Str::lit("tag"), Str::lit("verb"), Str::lit("name a local store entry"), Str::lit("now")), List::cons(f27(Str::lit("rmi"), Str::lit("verb"), Str::lit("remove a local store entry"), Str::lit("now")), List::<Adt4>::nil()))))))))))))))))))))
}

pub fn f17(v0: List<Str>) -> List<Str> {
    let m72 = v0;
    match m72.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(f11(List::cons(Str::lit("`"), List::cons(v1, List::cons(Str::lit("`"), List::<Str>::nil())))), f17(v2))
        }
    }
}

pub fn f18() -> List<Str> {
    List::cons(Str::lit("attest"), List::cons(Str::lit("auth"), List::cons(Str::lit("axioms"), List::cons(Str::lit("build"), List::cons(Str::lit("check"), List::cons(Str::lit("conformance"), List::cons(Str::lit("connect"), List::cons(Str::lit("containers"), List::cons(Str::lit("create"), List::cons(Str::lit("dev"), List::cons(Str::lit("df"), List::cons(Str::lit("disconnect"), List::cons(Str::lit("dispatch"), List::cons(Str::lit("errors"), List::cons(Str::lit("events"), List::cons(Str::lit("export"), List::cons(Str::lit("export-browser"), List::cons(Str::lit("fromKey"), List::cons(Str::lit("generate"), List::cons(Str::lit("get"), List::cons(Str::lit("identities"), List::cons(Str::lit("images"), List::cons(Str::lit("info"), List::cons(Str::lit("init"), List::cons(Str::lit("inspect"), List::cons(Str::lit("keyless"), List::cons(Str::lit("list"), List::cons(Str::lit("lock"), List::cons(Str::lit("login"), List::cons(Str::lit("logout"), List::cons(Str::lit("manifest"), List::cons(Str::lit("mcp"), List::cons(Str::lit("networks"), List::cons(Str::lit("open"), List::cons(Str::lit("providers"), List::cons(Str::lit("prune"), List::cons(Str::lit("pull"), List::cons(Str::lit("push"), List::cons(Str::lit("remove"), List::cons(Str::lit("replay"), List::cons(Str::lit("setup"), List::cons(Str::lit("start"), List::cons(Str::lit("stores"), List::cons(Str::lit("system"), List::cons(Str::lit("template"), List::cons(Str::lit("usage"), List::cons(Str::lit("vectors"), List::cons(Str::lit("verify"), List::cons(Str::lit("verify-attestation"), List::cons(Str::lit("version"), List::cons(Str::lit("volumes"), List::<Str>::nil())))))))))))))))))))))))))))))))))))))))))))))))))))
}

pub fn f19(v0: List<Adt2>) -> List<Str> {
    let m73 = v0;
    match m73.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(f11(List::cons(Str::lit("| "), List::cons(match v1.clone() {
                Adt2::C0(h74, _, _, _) => {
                    h74
                }
            }, List::cons(Str::lit(" | `"), List::cons(match v1.clone() {
                Adt2::C0(_, h75, _, _) => {
                    h75
                }
            }, List::cons(Str::lit("` | `"), List::cons(match v1.clone() {
                Adt2::C0(_, _, h76, _) => {
                    h76
                }
            }, List::cons(Str::lit("` | "), List::cons(match v1 {
                Adt2::C0(_, _, _, h77) => {
                    h77
                }
            }, List::cons(Str::lit(" |"), List::<Str>::nil())))))))))), f19(v2))
        }
    }
}

pub fn f20(v0: Str, v1: Str) -> bool {
    let a78 = v0;
    let a79 = v1;
    equal(a78, a79)
}

pub fn f21(v0: Str, v1: Str, p84: List<Adt4>) -> Option<Adt4> {
    let m83 = p84;
    {
        let mut m83 = m83;
        loop {
            let step = {
                let v2 = m83;
                let m80 = v2;
                match m80.uncons() {
                    None => {
                        Err::<List<Adt4>, Option<Adt4>>(None::<Adt4>)
                    }
                    Some((v3, v4)) => {
                        if if f20(match v3.clone() {
                            Adt4::C0(h81, _, _, _) => {
                                h81
                            }
                        }, v0.clone()) {
                            f20(match v3.clone() {
                                Adt4::C0(_, h82, _, _) => {
                                    h82
                                }
                            }, v1.clone())
                        } else {
                            false
                        } {
                            Err::<List<Adt4>, Option<Adt4>>(Some(v3))
                        } else {
                            Ok::<List<Adt4>, Option<Adt4>>(v4)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m83 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f22(v0: Str, p89: List<Str>) -> bool {
    let m88 = p89;
    {
        let mut m88 = m88;
        loop {
            let step = {
                let v1 = m88;
                let m85 = v1;
                match m85.uncons() {
                    None => {
                        Err::<List<Str>, bool>(false)
                    }
                    Some((v2, v3)) => {
                        let a86 = v2;
                        let a87 = v0.clone();
                        if equal(a86, a87) {
                            Err::<List<Str>, bool>(true)
                        } else {
                            Ok::<List<Str>, bool>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m88 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f23(p93: List<Str>) -> Option<(Str, Str)> {
    let m92 = p93;
    {
        let mut m92 = m92;
        loop {
            let step = {
                let v0 = m92;
                let m90 = v0;
                match m90.uncons() {
                    None => {
                        Err::<List<Str>, Option<(Str, Str)>>(None::<(Str, Str)>)
                    }
                    Some((v1, v2)) => {
                        let m91 = f28(v1.clone(), f29());
                        match m91 {
                            None => {
                                Ok::<List<Str>, Option<(Str, Str)>>(v2)
                            }
                            Some(v3) => {
                                Err::<List<Str>, Option<(Str, Str)>>(Some((v1, v3)))
                            }
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m92 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f24(v0: Str) -> R<List<Str>> {
    Ok(f30(f31({
        let a94 = v0;
        utf8_encode(a94)
    }, Bytes::lit(&[0x2d]))?))
}

pub fn f25(v0: Adt2, v1: Adt2) -> bool {
    if f20(match v0.clone() {
        Adt2::C0(h95, _, _, _) => {
            h95
        }
    }, match v1.clone() {
        Adt2::C0(h96, _, _, _) => {
            h96
        }
    }) {
        if f20(match v0.clone() {
            Adt2::C0(_, h97, _, _) => {
                h97
            }
        }, match v1.clone() {
            Adt2::C0(_, h98, _, _) => {
                h98
            }
        }) {
            if f20(match v0.clone() {
                Adt2::C0(_, _, h99, _) => {
                    h99
                }
            }, match v1.clone() {
                Adt2::C0(_, _, h100, _) => {
                    h100
                }
            }) {
                f20(match v0 {
                    Adt2::C0(_, _, _, h101) => {
                        h101
                    }
                }, match v1 {
                    Adt2::C0(_, _, _, h102) => {
                        h102
                    }
                })
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    }
}

pub fn f26(v0: Str) -> Str {
    if f20(v0.clone(), Str::lit("now")) {
        Str::lit("Now")
    } else {
        f11(List::cons(Str::lit("After "), List::cons(v0, List::<Str>::nil())))
    }
}

pub fn f27(v0: Str, v1: Str, v2: Str, v3: Str) -> Adt4 {
    Adt4::C0(v0, v1, v2, v3)
}

pub fn f28(v0: Str, p109: List<(Str, Str)>) -> Option<Str> {
    let m108 = p109;
    {
        let mut m108 = m108;
        loop {
            let step = {
                let v1 = m108;
                let m103 = v1;
                match m103.uncons() {
                    None => {
                        Err::<List<(Str, Str)>, Option<Str>>(None::<Str>)
                    }
                    Some((v2, v3)) => {
                        let a105 = {
                            let (h104, _) = v2;
                            h104
                        };
                        let a106 = v0.clone();
                        if equal(a105, a106) {
                            Err::<List<(Str, Str)>, Option<Str>>(Some({
                                let (_, h107) = v2;
                                h107
                            }))
                        } else {
                            Ok::<List<(Str, Str)>, Option<Str>>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m108 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f29() -> List<(Str, Str)> {
    List::cons((Str::lit("holo"), Str::lit("image")), List::cons((Str::lit("history"), Str::lit("recording")), List::cons((Str::lit("instance"), Str::lit("container")), List::cons((Str::lit("fingerprint"), Str::lit("digest")), List::<(Str, Str)>::nil()))))
}

pub fn f30(v0: List<Bytes>) -> List<Str> {
    let m110 = v0;
    match m110.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(f32(v1, Str::lit("")), f30(v2))
        }
    }
}

pub fn f31(v0: Bytes, v1: Bytes) -> R<List<Bytes>> {
    f33(v0.clone(), v1, 0u64, Bytes::lit(&[]), f34(v0))
}

pub fn f32(v0: Bytes, v1: Str) -> Str {
    let m112 = {
        let a111 = v0;
        utf8_decode(a111)
    };
    match m112 {
        None => {
            v1
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f33(v0: Bytes, v1: Bytes, v2: u64, v3: Bytes, v4: u64) -> R<List<Bytes>> {
    let m113 = v4;
    if m113 == 0 {
        Ok(List::cons(v3, List::<Bytes>::nil()))
    } else {
        let v5 = m113 - 1;
        if f35(f36(v0.clone(), v2, 1u64), v1.clone()) {
            Ok(List::cons(v3, f33(v0, v1, {
                let a114 = v2;
                let a115 = 1u64;
                nat_add(a114, a115)?
            }, Bytes::lit(&[]), v5)?))
        } else {
            f33(v0.clone(), v1, {
                let a116 = v2;
                let a117 = 1u64;
                nat_add(a116, a117)?
            }, {
                let a118 = v3;
                let a119 = f36(v0, v2, 1u64);
                append_bytes(a118, a119)
            }, v5)
        }
    }
}

pub fn f34(v0: Bytes) -> u64 {
    let a120 = v0;
    length_bytes(a120)
}

pub fn f35(v0: Bytes, v1: Bytes) -> bool {
    let a125 = {
        let a121 = v0;
        let a122 = v1;
        compare_bytes(a121, a122)
    };
    let a126 = {
        let a123 = Bytes::lit(&[0x00]);
        let a124 = Bytes::lit(&[0x00]);
        compare_bytes(a123, a124)
    };
    equal(a125, a126)
}

pub fn f36(v0: Bytes, v1: u64, v2: u64) -> Bytes {
    let m130 = {
        let a127 = v0;
        let a128 = v1;
        let a129 = v2;
        slice_bytes(a127, a128, a129)
    };
    match m130 {
        None => {
            Bytes::lit(&[])
        }
        Some(v3) => {
            v3
        }
    }
}

pub fn run(p0: Adt0) -> R<Adt3> {
    f0(p0)
}
