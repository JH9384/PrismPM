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
    Ok(f9(f10(v0.clone())?, f11(v0)?))
}

pub fn f3(v0: Bytes) -> u64 {
    let a28 = v0;
    length_bytes(a28)
}

pub fn f4(v0: Str, v1: Str) -> Adt4 {
    Adt4::C1(v0, v1)
}

pub fn f5(v0: List<Str>) -> Str {
    let a29 = v0;
    let a30 = Str::lit("");
    join(a29, a30)
}

pub fn f6(v0: Str) -> R<Adt14> {
    f12(f13({
        let a31 = v0;
        utf8_encode(a31)
    }, Bytes::lit(&[0x0a]))?, 1u64, None::<Str>, None::<Str>, false, List::<Str>::nil(), List::<Adt15>::nil())
}

pub fn f7(v0: u64, v1: Bytes, v2: Str) -> R<Str> {
    let a32 = v0;
    let a33 = 0u64;
    if nat_eq(a32, a33) {
        Ok(v2)
    } else {
        Ok(f5(List::cons(Str::lit("line "), List::cons(f14(v0)?, List::cons(Str::lit(": "), List::cons({
            let a35 = f3({
                let a34 = v2.clone();
                utf8_encode(a34)
            });
            let a36 = 0u64;
            if nat_eq(a35, a36) {
                f5(List::cons(f15(f16(v1))?, List::cons(Str::lit(" is outside the WIT subset generate reads"), List::<Str>::nil())))
            } else {
                v2
            }
        }, List::<Str>::nil()))))))
    }
}

pub fn f8(v0: Adt0, v1: Str, v2: Str, v3: List<Adt15>) -> R<Adt4> {
    let v4: Str = match v0.clone() {
        Adt0::C0(_, _, _, _, h37, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h37
        }
    };
    let v5: Str = match v0.clone() {
        Adt0::C0(_, h38, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h38
        }
    };
    let a40 = v1.clone();
    let a41 = match v0.clone() {
        Adt0::C0(_, _, h39, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h39
        }
    };
    if if equal(a40, a41) {
        let a43 = v2.clone();
        let a44 = match v0.clone() {
            Adt0::C0(_, _, _, h42, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h42
            }
        };
        equal(a43, a44)
    } else {
        false
    } {
        f17(v0, v1, v2, f18(v3.clone(), true), f18(v3, false))
    } else {
        Ok(f4(Str::lit("generate.world"), f5(List::cons(v4, List::cons(Str::lit(" declares "), List::cons(v1, List::cons(Str::lit(" world "), List::cons(v2, List::cons(Str::lit("; "), List::cons(v5, List::cons(Str::lit(" is "), List::cons(match v0.clone() {
            Adt0::C0(_, _, h45, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h45
            }
        }, List::cons(Str::lit(" world "), List::cons(match v0 {
            Adt0::C0(_, _, _, h46, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h46
            }
        }, List::<Str>::nil()))))))))))))))
    }
}

pub fn f9(v0: Option<(Str, Str)>, v1: List<Adt3>) -> Adt2 {
    let m47 = v0;
    match m47 {
        None => {
            Adt2::C0(v1)
        }
        Some(v2) => {
            Adt2::C1({
                let (h48, _) = v2;
                h48
            }, {
                let (_, h49) = v2;
                h49
            })
        }
    }
}

pub fn f10(v0: Adt5) -> R<Option<(Str, Str)>> {
    let v1: Adt9 = match v0.clone() {
        Adt5::C0(_, _, h50) => {
            h50
        }
    };
    let v2: Str = f19(match v1.clone() {
        Adt9::C0(_, _, h51, _, _, _, _, _) => {
            h51
        }
    })?;
    Ok(f20(f21(Str::lit("python"), f22(match v1.clone() {
        Adt9::C0(_, _, h52, _, _, _, _, _) => {
            h52
        }
    })?)?, f20(if f23(v2.clone(), List::cons(Str::lit("world"), List::cons(Str::lit("identity"), List::<Str>::nil()))) {
        Some((Str::lit("generate.model"), f5(List::cons(Str::lit("an application named "), List::cons(v2.clone(), List::cons(Str::lit(" collides with the "), List::cons(v2, List::cons(Str::lit(" module"), List::<Str>::nil()))))))))
    } else {
        None::<(Str, Str)>
    }, f20(f24(v1)?, f20(f25(Str::lit("python"), match v0.clone() {
        Adt5::C0(_, h53, _) => {
            h53
        }
    }), f26(Str::lit("python"), true, f27(), {
        let m56 = match v0 {
            Adt5::C0(_, h55, _) => {
                h55
            }
        };
        match m56 {
            Adt6::C0(_, _, _, _, _, _, _, _, h54) => {
                h54
            }
        }
    })?)))))
}

pub fn f11(v0: Adt5) -> R<List<Adt3>> {
    let v1: Str = match v0.clone() {
        Adt5::C0(h57, _, _) => {
            h57
        }
    };
    let v2: Adt6 = match v0.clone() {
        Adt5::C0(_, h58, _) => {
            h58
        }
    };
    let v3: Adt9 = match v0 {
        Adt5::C0(_, _, h59) => {
            h59
        }
    };
    let v4: Str = f19(match v3.clone() {
        Adt9::C0(_, _, h60, _, _, _, _, _) => {
            h60
        }
    })?;
    Ok(List::cons(f28(Str::lit("__init__.py"), f29(v1.clone(), v2.clone(), v3.clone(), v4.clone())?), List::cons(f28(Str::lit("identity.py"), f30(v1.clone(), v2.clone(), v3.clone())), List::cons(f28(Str::lit("world.py"), f31(v1.clone(), v2)?), List::cons(f28(f5(List::cons(v4, List::cons(Str::lit(".py"), List::<Str>::nil()))), {
        let m62 = match v3.clone() {
            Adt9::C0(_, _, _, _, _, _, _, h61) => {
                h61
            }
        };
        match m62 {
            Adt10::C0 => {
                f32(v1, v3)?
            }
            Adt10::C1(v5) => {
                f33(v1, v3, v5)?
            }
        }
    }), List::<Adt3>::nil())))))
}

pub fn f12(p89: List<Bytes>, p90: u64, p91: Option<Str>, p92: Option<Str>, p93: bool, p94: List<Str>, p95: List<Adt15>) -> R<Adt14> {
    let m88 = (p89, (p90, (p91, (p92, (p93, (p94, p95))))));
    {
        let mut m88 = m88;
        loop {
            let step = {
                let (v0, (v1, (v2, (v3, (v4, (v5, v6)))))) = m88;
                let m63 = v0;
                match m63.uncons() {
                    None => {
                        let m64 = v2;
                        match m64 {
                            None => {
                                Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(Adt14::C1(0u64, Bytes::lit(&[]), Str::lit("the WIT text has no complete package and world"))))
                            }
                            Some(v7) => {
                                let m65 = v3;
                                match m65 {
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
                        let v11: Bytes = f34(v9)?;
                        if f35(v11.clone(), Bytes::lit(&[0x2f, 0x2f, 0x2f])) {
                            Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                let a66 = v1;
                                let a67 = 1u64;
                                nat_add(a66, a67)?
                            }, (v2, (v3, (v4, ({
                                let a68 = v5;
                                let a69 = List::cons(f16(f34(f36(v11, 3u64, 0u64)?)?), List::<Str>::nil());
                                append_list(a68, a69)
                            }, v6)))))))
                        } else {
                            let a70 = f3(v11.clone());
                            let a71 = 0u64;
                            if if nat_eq(a70, a71) {
                                true
                            } else {
                                f35(v11.clone(), Bytes::lit(&[0x2f, 0x2f]))
                            } {
                                Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                    let a72 = v1;
                                    let a73 = 1u64;
                                    nat_add(a72, a73)?
                                }, (v2, (v3, (v4, (List::<Str>::nil(), v6)))))))
                            } else {
                                if v4 {
                                    Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f37(v1, Str::lit("nothing may follow the world"))))
                                } else {
                                    let a74 = f38(v2.clone());
                                    if if bool_not(a74) {
                                        let a75 = f38(v3.clone());
                                        if bool_not(a75) {
                                            if f35(v11.clone(), Bytes::lit(&[0x70, 0x61, 0x63, 0x6b, 0x61, 0x67, 0x65, 0x20])) {
                                                if f39(v11.clone(), Bytes::lit(&[0x3b]))? {
                                                    f40(f36(v11.clone(), 8u64, 1u64)?)?
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
                                            let a76 = v1;
                                            let a77 = 1u64;
                                            nat_add(a76, a77)?
                                        }, (Some(f16(f36(v11, 8u64, 1u64)?)), (v3, (v4, (List::<Str>::nil(), v6)))))))
                                    } else {
                                        if if f38(v2.clone()) {
                                            let a78 = f38(v3.clone());
                                            if bool_not(a78) {
                                                if f35(v11.clone(), Bytes::lit(&[0x77, 0x6f, 0x72, 0x6c, 0x64, 0x20])) {
                                                    if f39(v11.clone(), Bytes::lit(&[0x20, 0x7b]))? {
                                                        f41(f36(v11.clone(), 6u64, 2u64)?)?
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
                                                let a79 = v1;
                                                let a80 = 1u64;
                                                nat_add(a79, a80)?
                                            }, (v2, (Some(f16(f36(v11, 6u64, 2u64)?)), (v4, (List::<Str>::nil(), v6)))))))
                                        } else {
                                            if if f38(v3.clone()) {
                                                if f35(v11.clone(), Bytes::lit(&[0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20])) {
                                                    true
                                                } else {
                                                    f35(v11.clone(), Bytes::lit(&[0x69, 0x6d, 0x70, 0x6f, 0x72, 0x74, 0x20]))
                                                }
                                            } else {
                                                false
                                            } {
                                                let m81 = f42(v11.clone(), v5)?;
                                                match m81 {
                                                    Adt16::C0(v12) => {
                                                        Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                                            let a82 = v1;
                                                            let a83 = 1u64;
                                                            nat_add(a82, a83)?
                                                        }, (v2, (v3, (v4, (List::<Str>::nil(), {
                                                            let a84 = v6;
                                                            let a85 = List::cons(v12, List::<Adt15>::nil());
                                                            append_list(a84, a85)
                                                        })))))))
                                                    }
                                                    Adt16::C1 => {
                                                        Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f43(v1, v11)))
                                                    }
                                                    Adt16::C2(v13) => {
                                                        Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f37(v1, v13)))
                                                    }
                                                }
                                            } else {
                                                if if f38(v3.clone()) {
                                                    f44(v11.clone(), Bytes::lit(&[0x7d]))
                                                } else {
                                                    false
                                                } {
                                                    Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                                        let a86 = v1;
                                                        let a87 = 1u64;
                                                        nat_add(a86, a87)?
                                                    }, (v2, (v3, (true, (List::<Str>::nil(), v6)))))))
                                                } else {
                                                    Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f43(v1, v11)))
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
                Ok(next) => { m88 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f13(v0: Bytes, v1: Bytes) -> R<List<Bytes>> {
    f45(v0.clone(), v1, 0u64, Bytes::lit(&[]), f3(v0))
}

pub fn f14(v0: u64) -> R<Str> {
    Ok(f46(v0, {
        let a96 = v0;
        let a97 = 1u64;
        nat_add(a96, a97)?
    }))
}

pub fn f15(v0: Str) -> R<Str> {
    f47(v0, Bytes::lit(&[0x22]))
}

pub fn f16(v0: Bytes) -> Str {
    f48(v0, Str::lit(""))
}

pub fn f17(v0: Adt0, v1: Str, v2: Str, v3: List<Adt7>, v4: List<Adt7>) -> R<Adt4> {
    let v5: Str = match v0.clone() {
        Adt0::C0(_, _, _, _, h98, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h98
        }
    };
    let v6: Str = match v0.clone() {
        Adt0::C0(_, h99, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h99
        }
    };
    if if f49(f50(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, h100, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h100
        }
    }, f51(v3.clone())))? {
        let a102 = f52(f50(f51(v3.clone()), match v0.clone() {
            Adt0::C0(_, _, _, _, _, _, _, h101, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h101
            }
        }))?;
        let a103 = 0u64;
        nat_eq(a102, a103)
    } else {
        false
    } {
        let a105 = f53(v4.clone())?;
        let a106 = f52(match v0.clone() {
            Adt0::C0(_, _, _, _, _, _, _, _, h104, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h104
            }
        })?;
        if nat_eq(a105, a106) {
            let v7: Adt6 = Adt6::C0(v6, v1, v2, v5, match v0.clone() {
                Adt0::C0(_, _, _, _, _, h107, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h107
                }
            }, match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, h108, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h108
                }
            }, Str::lit("memory"), v4, v3);
            let m110 = match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, h109, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h109
                }
            };
            match m110 {
                None => {
                    let m112 = match v0.clone() {
                        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h111, _, _, _, _, _, _, _, _, _, _, _, _) => {
                            h111
                        }
                    };
                    match m112 {
                        None => {
                            Ok(f4(Str::lit("generate.model"), Str::lit("the application has no name")))
                        }
                        Some(v9) => {
                            f54(v0, v7, v9)
                        }
                    }
                }
                Some(v8) => {
                    f54(v0, v7, v8)
                }
            }
        } else {
            Ok(f4(Str::lit("generate.world"), f5(List::cons(Str::lit("the imports of "), List::cons(v5, List::cons(Str::lit(" do not match "), List::cons(v6, List::<Str>::nil())))))))
        }
    } else {
        Ok(f4(Str::lit("generate.world"), f5(List::cons(Str::lit("the exports of "), List::cons(v5, List::cons(Str::lit(" do not match "), List::cons(v6, List::cons(Str::lit(": "), List::cons({
            let a114 = match v0 {
                Adt0::C0(_, _, _, _, _, _, _, h113, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h113
                }
            };
            let a115 = Str::lit(", ");
            join(a114, a115)
        }, List::<Str>::nil())))))))))
    }
}

pub fn f18(v0: List<Adt15>, v1: bool) -> List<Adt7> {
    let m116 = v0;
    match m116.uncons() {
        None => {
            List::<Adt7>::nil()
        }
        Some((v2, v3)) => {
            if if v1 {
                match v2.clone() {
                    Adt15::C0(h117, _) => {
                        h117
                    }
                }
            } else {
                let a119 = match v2.clone() {
                    Adt15::C0(h118, _) => {
                        h118
                    }
                };
                bool_not(a119)
            } {
                List::cons(match v2 {
                    Adt15::C0(_, h120) => {
                        h120
                    }
                }, f18(v3, v1))
            } else {
                f18(v3, v1)
            }
        }
    }
}

pub fn f19(v0: Str) -> R<Str> {
    Ok(f55(f22(v0)?))
}

pub fn f20(v0: Option<(Str, Str)>, v1: Option<(Str, Str)>) -> Option<(Str, Str)> {
    let m121 = v0.clone();
    match m121 {
        None => {
            v1
        }
        Some(_) => {
            v0
        }
    }
}

pub fn f21(v0: Str, v1: Str) -> R<Option<(Str, Str)>> {
    if f56(v1.clone())? {
        Ok(None::<(Str, Str)>)
    } else {
        Ok(Some((Str::lit("generate.model"), f5(List::cons(f15(v1)?, List::cons(Str::lit(" is not a name the "), List::cons(v0, List::cons(Str::lit(" writer can bind"), List::<Str>::nil()))))))))
    }
}

pub fn f22(v0: Str) -> R<Str> {
    Ok(f48(f57({
        let a122 = v0.clone();
        utf8_encode(a122)
    }, 0u64, false, {
        let a124 = {
            let a123 = v0.clone();
            utf8_encode(a123)
        };
        length_bytes(a124)
    })?, v0))
}

pub fn f23(v0: Str, p129: List<Str>) -> bool {
    let m128 = p129;
    {
        let mut m128 = m128;
        loop {
            let step = {
                let v1 = m128;
                let m125 = v1;
                match m125.uncons() {
                    None => {
                        Err::<List<Str>, bool>(false)
                    }
                    Some((v2, v3)) => {
                        let a126 = v2;
                        let a127 = v0.clone();
                        if equal(a126, a127) {
                            Err::<List<Str>, bool>(true)
                        } else {
                            Ok::<List<Str>, bool>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m128 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f24(v0: Adt9) -> R<Option<(Str, Str)>> {
    let m131 = match v0.clone() {
        Adt9::C0(_, _, _, _, _, _, _, h130) => {
            h130
        }
    };
    match m131 {
        Adt10::C0 => {
            Ok(None::<(Str, Str)>)
        }
        Adt10::C1(v1) => {
            Ok(f20(f58(Str::lit("python"), match v1.clone() {
                Adt11::C0(_, _, _, _, h132, _) => {
                    h132
                }
            })?, f20(f21(Str::lit("python"), f22(match v1.clone() {
                Adt11::C0(_, h133, _, _, _, _) => {
                    h133
                }
            })?)?, f20(f59(f19(match v1.clone() {
                Adt11::C0(_, h134, _, _, _, _) => {
                    h134
                }
            })?, match v1.clone() {
                Adt11::C0(_, _, _, _, h135, _) => {
                    h135
                }
            })?, f60(v0, v1)))))
        }
    }
}

pub fn f25(v0: Str, v1: Adt6) -> Option<(Str, Str)> {
    let a139 = {
        let a137 = match v1.clone() {
            Adt6::C0(h136, _, _, _, _, _, _, _, _) => {
                h136
            }
        };
        let a138 = Str::lit("hologram:guest/core-wasm@1");
        equal(a137, a138)
    };
    if bool_not(a139) {
        Some((Str::lit("generate.world"), f5(List::cons(Str::lit("the "), List::cons(v0, List::cons(Str::lit(" writer has no host protocol for "), List::cons(match v1 {
            Adt6::C0(h140, _, _, _, _, _, _, _, _) => {
                h140
            }
        }, List::<Str>::nil())))))))
    } else {
        let m142 = match v1.clone() {
            Adt6::C0(_, _, _, _, _, _, _, h141, _) => {
                h141
            }
        };
        match m142.uncons() {
            None => {
                None::<(Str, Str)>
            }
            Some((_, _)) => {
                Some((Str::lit("generate.world"), f5(List::cons(Str::lit("the "), List::cons(v0, List::cons(Str::lit(" writer binds import-free worlds; "), List::cons(match v1 {
                    Adt6::C0(h143, _, _, _, _, _, _, _, _) => {
                        h143
                    }
                }, List::cons(Str::lit(" has imports"), List::<Str>::nil()))))))))
            }
        }
    }
}

pub fn f26(v0: Str, v1: bool, v2: List<(Str, Str)>, v3: List<Adt7>) -> R<Option<(Str, Str)>> {
    let m144 = v3;
    match m144.uncons() {
        None => {
            Ok(None::<(Str, Str)>)
        }
        Some((v4, v5)) => {
            Ok(f20(if v1 {
                f21(v0.clone(), match v4.clone() {
                    Adt7::C0(h145, _, _, _) => {
                        h145
                    }
                })?
            } else {
                None::<(Str, Str)>
            }, f20(f61(v0.clone(), v1, v2.clone(), match v4.clone() {
                Adt7::C0(_, h146, _, _) => {
                    h146
                }
            })?, f20({
                let m148 = match v4 {
                    Adt7::C0(_, _, h147, _) => {
                        h147
                    }
                };
                match m148 {
                    None => {
                        None::<(Str, Str)>
                    }
                    Some(v6) => {
                        f62(v0.clone(), v6, v2.clone())
                    }
                }
            }, f26(v0, v1, v2, v5)?))))
        }
    }
}

pub fn f27() -> List<(Str, Str)> {
    List::cons((Str::lit("bool"), Str::lit("bool")), List::cons((Str::lit("u8"), Str::lit("int")), List::cons((Str::lit("u16"), Str::lit("int")), List::cons((Str::lit("u32"), Str::lit("int")), List::cons((Str::lit("u64"), Str::lit("int")), List::cons((Str::lit("s8"), Str::lit("int")), List::cons((Str::lit("s16"), Str::lit("int")), List::cons((Str::lit("s32"), Str::lit("int")), List::cons((Str::lit("s64"), Str::lit("int")), List::cons((Str::lit("f32"), Str::lit("float")), List::cons((Str::lit("f64"), Str::lit("float")), List::cons((Str::lit("char"), Str::lit("int")), List::<(Str, Str)>::nil()))))))))))))
}

pub fn f28(v0: Str, v1: Str) -> Adt3 {
    Adt3::C0(v0, v1)
}

pub fn f29(v0: Str, v1: Adt6, v2: Adt9, v3: Str) -> R<Str> {
    let v4: List<Str> = f63(f64(v2.clone()))?;
    let v5: List<Str> = f65(f5(List::cons(Str::lit("from ."), List::cons(v3.clone(), List::cons(Str::lit(" import "), List::<Str>::nil())))), v4.clone(), Str::lit("("), Str::lit(")"));
    let v6: List<Str> = List::cons(Str::lit("from .identity import Identity"), List::<Str>::nil());
    Ok(f66({
        let a172 = List::cons(f67(Str::lit("#"), v0.clone(), f5(List::cons(match v2.clone() {
            Adt9::C0(h149, _, _, _, _, _, _, _) => {
                h149
            }
        }, List::cons(Str::lit("'s model and the WIT world "), List::cons(match v1.clone() {
            Adt6::C0(h150, _, _, _, _, _, _, _, _) => {
                h150
            }
        }, List::<Str>::nil()))))), List::cons(f5(List::cons(Str::lit("\"\"\"A client for "), List::cons(match v2.clone() {
            Adt9::C0(h151, _, _, _, _, _, _, _) => {
                h151
            }
        }, List::cons(Str::lit(", generated by "), List::cons(v0, List::cons(Str::lit("."), List::<Str>::nil())))))), List::<Str>::nil()));
        let a173 = {
            let a170 = {
                let m153 = match v2.clone() {
                    Adt9::C0(_, _, _, h152, _, _, _, _) => {
                        h152
                    }
                };
                match m153 {
                    None => {
                        List::<Str>::nil()
                    }
                    Some(v7) => {
                        List::cons(Str::lit(""), List::cons(v7, List::<Str>::nil()))
                    }
                }
            };
            let a171 = {
                let a168 = List::cons(Str::lit(""), List::cons(f5(List::cons(Str::lit("`world` is the world "), List::cons(match v1 {
                    Adt6::C0(h154, _, _, _, _, _, _, _, _) => {
                        h154
                    }
                }, List::cons(Str::lit(": implement `world.Guest` over your WebAssembly engine,"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("and `world.dispatch` sends it a request. `"), List::cons(v3.clone(), List::cons(Str::lit("` is the client of "), List::cons(match v2 {
                    Adt9::C0(h155, _, _, _, _, _, _, _) => {
                        h155
                    }
                }, List::cons(Str::lit("."), List::<Str>::nil())))))), List::cons(Str::lit("\"\"\"\u{a}"), List::cons(f5(List::cons(Str::lit("from . import "), List::cons({
                    let a156 = f68(List::cons(v3.clone(), List::cons(Str::lit("world"), List::<Str>::nil())));
                    let a157 = Str::lit(", ");
                    join(a156, a157)
                }, List::<Str>::nil()))), List::<Str>::nil())))));
                let a169 = {
                    let a166 = if f69(f5(List::cons(Str::lit("."), List::cons(v3.clone(), List::<Str>::nil()))), Str::lit(".identity")) {
                        let a158 = v5;
                        let a159 = v6;
                        append_list(a158, a159)
                    } else {
                        let a160 = v6;
                        let a161 = v5;
                        append_list(a160, a161)
                    };
                    let a167 = {
                        let a164 = List::cons(Str::lit(""), List::<Str>::nil());
                        let a165 = f65(Str::lit("__all__ = "), f70(f68({
                            let a162 = v4;
                            let a163 = List::cons(Str::lit("Identity"), List::cons(v3, List::cons(Str::lit("world"), List::<Str>::nil())));
                            append_list(a162, a163)
                        }))?, Str::lit("["), Str::lit("]"));
                        append_list(a164, a165)
                    };
                    append_list(a166, a167)
                };
                append_list(a168, a169)
            };
            append_list(a170, a171)
        };
        append_list(a172, a173)
    }))
}

pub fn f30(v0: Str, v1: Adt6, v2: Adt9) -> Str {
    f66(List::cons(f67(Str::lit("#"), v0, f5(List::cons(match v2 {
        Adt9::C0(h174, _, _, _, _, _, _, _) => {
            h174
        }
    }, List::cons(Str::lit("'s model and the WIT world "), List::cons(match v1 {
        Adt6::C0(h175, _, _, _, _, _, _, _, _) => {
            h175
        }
    }, List::<Str>::nil()))))), List::cons(Str::lit("\"\"\"What a set of bindings was generated from.\"\"\"\u{a}\u{a}from typing import NamedTuple\u{a}\u{a}\u{a}class Identity(NamedTuple):\u{a}    \"\"\"A name and both digests, as prismpm.lock records them.\"\"\"\u{a}\u{a}    name: str\u{a}    \"\"\"The world's contract, or the application's name.\"\"\"\u{a}    blake3: str\u{a}    \"\"\"The BLAKE3 digest, lowercase hex.\"\"\"\u{a}    sha256: str\u{a}    \"\"\"The SHA-256 digest, lowercase hex.\"\"\""), List::<Str>::nil())))
}

pub fn f31(v0: Str, v1: Adt6) -> R<Str> {
    Ok(f66({
        let a191 = List::cons(f67(Str::lit("#"), v0, f71(v1.clone())), List::cons(f5(List::cons(Str::lit("\"\"\"The world "), List::cons(match v1.clone() {
            Adt6::C0(h176, _, _, _, _, _, _, _, _) => {
                h176
            }
        }, List::cons(Str::lit(": its identity, its exports, and how a host sends it a request.\"\"\""), List::<Str>::nil())))), List::cons(Str::lit("\u{a}from typing import Protocol\u{a}\u{a}from .identity import Identity\u{a}\u{a}WORLD = Identity("), List::cons(f5(List::cons(Str::lit("    name="), List::cons(f15(match v1.clone() {
            Adt6::C0(h177, _, _, _, _, _, _, _, _) => {
                h177
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    blake3="), List::cons(f15(match v1.clone() {
            Adt6::C0(_, _, _, _, h178, _, _, _, _) => {
                h178
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    sha256="), List::cons(f15(match v1.clone() {
            Adt6::C0(_, _, _, _, _, h179, _, _, _) => {
                h179
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(Str::lit(")\u{a}\"\"\"The world these bindings were generated from. It equals `inputs.world` in prismpm.lock.\"\"\"\u{a}"), List::cons(f5(List::cons(Str::lit("EXPORTS = ("), List::cons({
            let a182 = f70(f68(List::cons(match v1.clone() {
                Adt6::C0(_, _, _, _, _, _, h180, _, _) => {
                    h180
                }
            }, f72(match v1.clone() {
                Adt6::C0(_, _, _, _, _, _, _, _, h181) => {
                    h181
                }
            }))))?;
            let a183 = Str::lit(", ");
            join(a182, a183)
        }, List::cons(Str::lit(")"), List::<Str>::nil())))), List::cons(Str::lit("\"\"\"Every export the world requires, sorted. A guest that offers any other is not of this world.\"\"\"\u{a}\u{a}\u{a}class Guest(Protocol):"), List::cons(f5(List::cons(Str::lit("    \"\"\"A guest of "), List::cons(match v1.clone() {
            Adt6::C0(h184, _, _, _, _, _, _, _, _) => {
                h184
            }
        }, List::cons(Str::lit(", instantiated by the host's WebAssembly engine."), List::<Str>::nil())))), List::cons(Str::lit(""), List::cons(f5(List::cons(Str::lit("    The guest imports nothing. Implement this over the engine's instance: each export, and `"), List::cons(match v1.clone() {
            Adt6::C0(_, _, _, _, _, _, h185, _, _) => {
                h185
            }
        }, List::cons(Str::lit("` as a read and a write."), List::<Str>::nil())))), List::cons(Str::lit("    A failed call into the guest, such as a trap, raises the engine's own exception.\u{a}    \"\"\""), List::<Str>::nil())))))))))))));
        let a192 = {
            let a189 = f73(match v1.clone() {
                Adt6::C0(_, _, _, _, _, _, _, _, h186) => {
                    h186
                }
            })?;
            let a190 = List::cons(Str::lit("\u{a}    def write_memory(self, offset: int, data: bytes) -> None:"), List::cons(f5(List::cons(Str::lit("        \"\"\"Copy `data` into the guest's `"), List::cons(match v1.clone() {
                Adt6::C0(_, _, _, _, _, _, h187, _, _) => {
                    h187
                }
            }, List::cons(Str::lit("` at `offset`.\"\"\""), List::<Str>::nil())))), List::cons(Str::lit("        ...\u{a}\u{a}    def read_memory(self, offset: int, length: int) -> bytes:"), List::cons(f5(List::cons(Str::lit("        \"\"\"Copy `length` bytes out of the guest's `"), List::cons(match v1 {
                Adt6::C0(_, _, _, _, _, _, h188, _, _) => {
                    h188
                }
            }, List::cons(Str::lit("` at `offset`. Raises when they are outside it.\"\"\""), List::<Str>::nil())))), List::cons(Str::lit("        ...\u{a}\u{a}"), List::cons(f74(), List::<Str>::nil()))))));
            append_list(a189, a190)
        };
        append_list(a191, a192)
    }))
}

pub fn f32(v0: Str, v1: Adt9) -> R<Str> {
    let v2: Str = match v1.clone() {
        Adt9::C0(h193, _, _, _, _, _, _, _) => {
            h193
        }
    };
    Ok(f66({
        let a202 = List::cons(f67(Str::lit("#"), v0, f75(v1.clone())), List::cons(f5(List::cons(Str::lit("\"\"\"The client of "), List::cons(v2.clone(), List::cons(Str::lit(", over request and response bytes.\"\"\""), List::<Str>::nil())))), List::cons(Str::lit("\u{a}from typing import Callable\u{a}\u{a}from .identity import Identity\u{a}\u{a}MODEL = Identity("), List::cons(f5(List::cons(Str::lit("    name="), List::cons(f15(match v1.clone() {
            Adt9::C0(h194, _, _, _, _, _, _, _) => {
                h194
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    blake3="), List::cons(f15(match v1.clone() {
            Adt9::C0(_, _, _, _, _, h195, _, _) => {
                h195
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    sha256="), List::cons(f15(match v1.clone() {
            Adt9::C0(_, _, _, _, _, _, h196, _) => {
                h196
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(Str::lit(")\u{a}\"\"\"The model this client was generated from. It equals `inputs.model` in prismpm.lock.\"\"\"\u{a}\u{a}"), List::cons(f5(List::cons(Str::lit("class "), List::cons(match v1.clone() {
            Adt9::C0(_, h197, _, _, _, _, _, _) => {
                h197
            }
        }, List::cons(Str::lit(":"), List::<Str>::nil())))), List::<Str>::nil()))))))));
        let a203 = {
            let a200 = f76(Str::lit("    "), {
                let a198 = f77(v1, f5(List::cons(Str::lit("A client for "), List::cons(v2.clone(), List::cons(Str::lit(", over request and response bytes."), List::<Str>::nil())))));
                let a199 = List::cons(Str::lit(""), List::cons(f5(List::cons(v2, List::cons(Str::lit("'s model describes no typed operations, so the client sends bytes."), List::<Str>::nil()))), List::<Str>::nil()));
                append_list(a198, a199)
            })?;
            let a201 = List::cons(Str::lit("\u{a}    def __init__(self, dispatch: Callable[[bytes], bytes]) -> None:\u{a}        \"\"\"A client over this dispatch function.\"\"\"\u{a}        self._dispatch = dispatch\u{a}\u{a}    def invoke(self, request: bytes) -> bytes:\u{a}        \"\"\"Send one request and return the response bytes.\"\"\"\u{a}        return bytes(self._dispatch(bytes(request)))"), List::<Str>::nil());
            append_list(a200, a201)
        };
        append_list(a202, a203)
    }))
}

pub fn f33(v0: Str, v1: Adt9, v2: Adt11) -> R<Str> {
    let v3: Str = match v1.clone() {
        Adt9::C0(h204, _, _, _, _, _, _, _) => {
            h204
        }
    };
    let v4: Str = match v2.clone() {
        Adt11::C0(h205, _, _, _, _, _) => {
            h205
        }
    };
    let v5: Str = match v2.clone() {
        Adt11::C0(_, _, _, h206, _, _) => {
            h206
        }
    };
    let v6: Str = f5(List::cons(v5.clone(), List::cons(Str::lit("Code"), List::<Str>::nil())));
    let v7: Str = match v2.clone() {
        Adt11::C0(_, _, h207, _, _, _) => {
            h207
        }
    };
    let v8: Str = f19(match v2.clone() {
        Adt11::C0(_, h208, _, _, _, _) => {
            h208
        }
    })?;
    Ok(f66({
        let a237 = List::cons(f67(Str::lit("#"), v0, f75(v1.clone())), List::cons(f5(List::cons(Str::lit("\"\"\"The client of "), List::cons(v3.clone(), List::cons(Str::lit(": one method per operation, over any dispatch function.\"\"\""), List::<Str>::nil())))), List::cons(Str::lit("\u{a}from enum import Enum\u{a}from typing import Callable, Optional\u{a}\u{a}from .identity import Identity\u{a}\u{a}MODEL = Identity("), List::cons(f5(List::cons(Str::lit("    name="), List::cons(f15(match v1.clone() {
            Adt9::C0(h209, _, _, _, _, _, _, _) => {
                h209
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    blake3="), List::cons(f15(match v1.clone() {
            Adt9::C0(_, _, _, _, _, h210, _, _) => {
                h210
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    sha256="), List::cons(f15(match v1.clone() {
            Adt9::C0(_, _, _, _, _, _, h211, _) => {
                h211
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(Str::lit(")\u{a}\"\"\"The model this client was generated from. It equals `inputs.model` in prismpm.lock.\"\"\"\u{a}"), List::cons(f5(List::cons(Str::lit("APPLICATION = "), List::cons(f15(v3.clone())?, List::<Str>::nil()))), List::cons(f5(List::cons(Str::lit("VERSION = "), List::cons(f15(v4.clone())?, List::<Str>::nil()))), List::cons(Str::lit("MINIMUM = -(2**63)\u{a}MAXIMUM = 2**63 - 1\u{a}\u{a}"), List::cons(f5(List::cons(Str::lit("class "), List::cons(v7.clone(), List::cons(Str::lit("(str, Enum):"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    \"\"\"An operation "), List::cons(v3.clone(), List::cons(Str::lit(" accepts; its value is the name the guest reads in a request.\"\"\""), List::<Str>::nil())))), List::cons(Str::lit(""), List::<Str>::nil())))))))))))));
        let a238 = {
            let a235 = f78(match v2.clone() {
                Adt11::C0(_, _, _, _, h212, _) => {
                    h212
                }
            })?;
            let a236 = {
                let a233 = List::cons(Str::lit("\u{a}"), List::cons(f5(List::cons(Str::lit("class "), List::cons(v6.clone(), List::cons(Str::lit("(str, Enum):"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    \"\"\"An answer with which "), List::cons(v3.clone(), List::cons(Str::lit(" refuses a request; its value is the code as the guest wrote it.\"\"\""), List::<Str>::nil())))), List::cons(Str::lit(""), List::<Str>::nil()))));
                let a234 = {
                    let a231 = f79(v1.clone(), v4.clone(), match v2.clone() {
                        Adt11::C0(_, _, _, _, _, h213) => {
                            h213
                        }
                    })?;
                    let a232 = {
                        let a229 = List::cons(Str::lit("\u{a}    @property\u{a}    def message(self) -> str:\u{a}        \"\"\"What the model says this answer means, for a person.\"\"\"\u{a}        return _MESSAGES[self]\u{a}\u{a}\u{a}_MESSAGES = {"), List::<Str>::nil());
                        let a230 = {
                            let a227 = f80(v1.clone(), v4, v6.clone(), match v2.clone() {
                                Adt11::C0(_, _, _, _, _, h214) => {
                                    h214
                                }
                            })?;
                            let a228 = {
                                let a225 = List::cons(Str::lit("}\u{a}\u{a}"), List::cons(f5(List::cons(Str::lit("class "), List::cons(v5.clone(), List::cons(Str::lit("(Exception):"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    \"\"\""), List::cons(v3.clone(), List::cons(Str::lit(" refused a request, for example on overflow.\"\"\""), List::<Str>::nil())))), List::cons(Str::lit(""), List::cons(f5(List::cons(Str::lit("    def __init__(self, code: str, known: Optional["), List::cons(v6.clone(), List::cons(Str::lit("]) -> None:"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("        message = known.message if known is not None else "), List::cons(f15(f5(List::cons(v3.clone(), List::cons(Str::lit(" refused the request."), List::<Str>::nil()))))?, List::<Str>::nil()))), List::cons(Str::lit("        super().__init__(f\"{message} ({code})\")\u{a}        self.code = code\u{a}        \"\"\"The code as the guest wrote it.\"\"\"\u{a}        self.known = known\u{a}        \"\"\"The code, when this client was generated with it; otherwise None.\"\"\"\u{a}        self.message = message\u{a}        \"\"\"What the model says the code means, for a person.\"\"\"\u{a}\u{a}\u{a}class ResponseError(Exception):"), List::cons(f5(List::cons(Str::lit("    \"\"\""), List::cons(v3.clone(), List::cons(Str::lit(" sent an answer this client cannot read.\"\"\""), List::<Str>::nil())))), List::cons(Str::lit("\u{a}"), List::cons(f5(List::cons(Str::lit("class "), List::cons(match v1.clone() {
                                    Adt9::C0(_, h215, _, _, _, _, _, _) => {
                                        h215
                                    }
                                }, List::cons(Str::lit(":"), List::<Str>::nil())))), List::<Str>::nil()))))))))));
                                let a226 = {
                                    let a223 = f76(Str::lit("    "), {
                                        let a216 = f77(v1, f5(List::cons(Str::lit("A client for "), List::cons(v3.clone(), List::cons(Str::lit("."), List::<Str>::nil())))));
                                        let a217 = List::cons(Str::lit(""), List::cons(Str::lit("`dispatch` sends request bytes to the guest and returns its response bytes, for"), List::cons(Str::lit("example `lambda request: world.dispatch(fresh_instance(), request)`."), List::<Str>::nil())));
                                        append_list(a216, a217)
                                    })?;
                                    let a224 = {
                                        let a221 = List::cons(Str::lit("\u{a}    def __init__(self, dispatch: Callable[[bytes], bytes]) -> None:\u{a}        \"\"\"A client over this dispatch function.\"\"\"\u{a}        self._dispatch = dispatch"), List::<Str>::nil());
                                        let a222 = {
                                            let a219 = f81(v8.clone(), v7.clone(), match v2 {
                                                Adt11::C0(_, _, _, _, h218, _) => {
                                                    h218
                                                }
                                            })?;
                                            let a220 = List::cons(Str::lit(""), List::cons(f5(List::cons(Str::lit("    def "), List::cons(v8, List::cons(Str::lit("(self, operation: "), List::cons(v7.clone(), List::cons(Str::lit(", left: int, right: int) -> int:"), List::<Str>::nil())))))), List::cons(Str::lit("        \"\"\"Apply `operation` to two signed 64-bit integers.\u{a}"), List::cons(f5(List::cons(Str::lit("        A refusal by "), List::cons(v3, List::cons(Str::lit(" raises `"), List::cons(v5.clone(), List::cons(Str::lit("`; an operand outside"), List::<Str>::nil())))))), List::cons(Str::lit("        the signed 64-bit range raises ValueError before anything is sent.\u{a}        \"\"\""), List::cons(f5(List::cons(Str::lit("        operation = "), List::cons(v7, List::cons(Str::lit("(operation)"), List::<Str>::nil())))), List::cons(Str::lit("        for operand in (left, right):\u{a}            if isinstance(operand, bool) or not isinstance(operand, int):\u{a}                raise TypeError(f\"{operand!r} is not an int\")\u{a}            if not MINIMUM <= operand <= MAXIMUM:\u{a}                raise ValueError(f\"{operand} is outside the signed 64-bit range\")\u{a}        request = f\"{VERSION}\\t{operation.value}\\t{left}\\t{right}\"\u{a}        return _read(bytes(self._dispatch(request.encode(\"utf-8\"))))\u{a}\u{a}\u{a}def _read(response: bytes) -> int:\u{a}    \"\"\"Read a response: the request version, then `ok` and a value or `error` and a code.\"\"\"\u{a}    try:\u{a}        text = response.decode(\"utf-8\")\u{a}    except UnicodeDecodeError:\u{a}        raise ResponseError(\"it is not UTF-8\") from None\u{a}    fields = text.split(\"\\t\")\u{a}    if len(fields) > 3:\u{a}        raise ResponseError(f\"{text!r} has more than three fields\")\u{a}    if fields[0] != VERSION:"), List::cons(f5(List::cons(Str::lit("        refused = "), List::cons(v6.clone(), List::cons(Str::lit(".UNSUPPORTED_VERSION"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("        raise "), List::cons(v5.clone(), List::cons(Str::lit("(refused.value, refused)"), List::<Str>::nil())))), List::cons(Str::lit("    if len(fields) == 3 and fields[1] == \"ok\":\u{a}        value = fields[2]\u{a}        if not value.lstrip(\"-\").isdigit() or not MINIMUM <= int(value) <= MAXIMUM:\u{a}            raise ResponseError(f\"{value!r} is not a signed 64-bit integer\")\u{a}        return int(value)\u{a}    if len(fields) == 3 and fields[1] == \"error\":"), List::cons(f5(List::cons(Str::lit("        known = next((code for code in "), List::cons(v6, List::cons(Str::lit(" if code.value == fields[2]), None)"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("        raise "), List::cons(v5, List::cons(Str::lit("(fields[2], known)"), List::<Str>::nil())))), List::cons(Str::lit("    raise ResponseError(f\"{text!r} is neither ok nor error\")"), List::<Str>::nil())))))))))))));
                                            append_list(a219, a220)
                                        };
                                        append_list(a221, a222)
                                    };
                                    append_list(a223, a224)
                                };
                                append_list(a225, a226)
                            };
                            append_list(a227, a228)
                        };
                        append_list(a229, a230)
                    };
                    append_list(a231, a232)
                };
                append_list(a233, a234)
            };
            append_list(a235, a236)
        };
        append_list(a237, a238)
    }))
}

pub fn f34(v0: Bytes) -> R<Bytes> {
    let v1: u64 = f82(v0.clone(), 0u64, f3(v0.clone()))?;
    let v2: u64 = f83(v0.clone(), 0u64, f3(v0.clone()), 0u64)?;
    let a239 = v2;
    let a240 = v1;
    if nat_le(a239, a240) {
        Ok(Bytes::lit(&[]))
    } else {
        Ok(f84(v0, v1, f85(v2, v1)?))
    }
}

pub fn f35(v0: Bytes, v1: Bytes) -> bool {
    f44(f84(v0, 0u64, f3(v1.clone())), v1)
}

pub fn f36(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let a243 = {
        let a241 = v1;
        let a242 = v2;
        nat_add(a241, a242)?
    };
    let a244 = f3(v0.clone());
    if nat_le(a243, a244) {
        Ok(f84(v0.clone(), v1, f85(f3(v0), {
            let a245 = v1;
            let a246 = v2;
            nat_add(a245, a246)?
        })?))
    } else {
        Ok(Bytes::lit(&[]))
    }
}

pub fn f37(v0: u64, v1: Str) -> Adt14 {
    Adt14::C1(v0, Bytes::lit(&[]), v1)
}

pub fn f38(v0: Option<Str>) -> bool {
    let m247 = v0;
    match m247 {
        None => {
            false
        }
        Some(_) => {
            true
        }
    }
}

pub fn f39(v0: Bytes, v1: Bytes) -> R<bool> {
    let a248 = f3(v1.clone());
    let a249 = f3(v0.clone());
    if nat_le(a248, a249) {
        Ok(f44(f84(v0.clone(), f85(f3(v0), f3(v1.clone()))?, f3(v1.clone())), v1))
    } else {
        Ok(false)
    }
}

pub fn f40(v0: Bytes) -> R<bool> {
    let m250 = f86(v0.clone(), Bytes::lit(&[0x3a]), 0u64, f3(v0.clone()))?;
    match m250 {
        None => {
            Ok(false)
        }
        Some(v1) => {
            if f41(f84(v0.clone(), 0u64, v1))? {
                f87(f36(v0, {
                    let a251 = v1;
                    let a252 = 1u64;
                    nat_add(a251, a252)?
                }, 0u64)?)
            } else {
                Ok(false)
            }
        }
    }
}

pub fn f41(v0: Bytes) -> R<bool> {
    if f88(f84(v0.clone(), 0u64, 1u64)) {
        f89(v0.clone(), 0u64, f3(v0), false)
    } else {
        Ok(false)
    }
}

pub fn f42(v0: Bytes, v1: List<Str>) -> R<Adt16> {
    let v2: Bytes = f36(v0.clone(), 7u64, 0u64)?;
    let m253 = f86(v2.clone(), Bytes::lit(&[0x3a]), 0u64, f3(v2.clone()))?;
    match m253 {
        None => {
            Ok(Adt16::C1)
        }
        Some(v3) => {
            let v4: Bytes = f84(v2.clone(), 0u64, v3);
            let v5: Bytes = f36(v2.clone(), {
                let a254 = v3;
                let a255 = 7u64;
                nat_add(a254, a255)?
            }, 0u64)?;
            if if f44(f84(v2, v3, 7u64), Bytes::lit(&[0x3a, 0x20, 0x66, 0x75, 0x6e, 0x63, 0x28])) {
                if f41(v4.clone())? {
                    f39(v5.clone(), Bytes::lit(&[0x3b]))?
                } else {
                    false
                }
            } else {
                false
            } {
                let m256 = f86(v5.clone(), Bytes::lit(&[0x29]), 0u64, f3(v5.clone()))?;
                match m256 {
                    None => {
                        Ok(Adt16::C1)
                    }
                    Some(v6) => {
                        let v7: Bytes = f36(v5.clone(), {
                            let a257 = v6;
                            let a258 = 1u64;
                            nat_add(a257, a258)?
                        }, 0u64)?;
                        let v8: bool = if f44(v7.clone(), Bytes::lit(&[0x3b])) {
                            true
                        } else {
                            if f35(v7.clone(), Bytes::lit(&[0x20, 0x2d, 0x3e, 0x20])) {
                                f41(f36(v7.clone(), 4u64, 1u64)?)?
                            } else {
                                false
                            }
                        };
                        if v8 {
                            let v9: Option<Str> = if f44(v7.clone(), Bytes::lit(&[0x3b])) {
                                None::<Str>
                            } else {
                                Some(f16(f36(v7, 4u64, 1u64)?))
                            };
                            let m259 = v9.clone();
                            match m259 {
                                None => {
                                    let m262 = f91(f84(v5, 0u64, v6))?;
                                    match m262 {
                                        Adt17::C0(v13) => {
                                            Ok(Adt16::C0(Adt15::C0(f35(v0, Bytes::lit(&[0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20])), Adt7::C0(f92(v4)?, v13, v9, v1))))
                                        }
                                        Adt17::C1(v14) => {
                                            Ok(Adt16::C2(v14))
                                        }
                                    }
                                }
                                Some(v10) => {
                                    if f23(v10.clone(), f90()) {
                                        let m260 = f91(f84(v5, 0u64, v6))?;
                                        match m260 {
                                            Adt17::C0(v11) => {
                                                Ok(Adt16::C0(Adt15::C0(f35(v0, Bytes::lit(&[0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20])), Adt7::C0(f92(v4)?, v11, v9, v1))))
                                            }
                                            Adt17::C1(v12) => {
                                                Ok(Adt16::C2(v12))
                                            }
                                        }
                                    } else {
                                        Ok(Adt16::C2(f93({
                                            let a261 = v10;
                                            utf8_encode(a261)
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

pub fn f43(v0: u64, v1: Bytes) -> Adt14 {
    Adt14::C1(v0, v1, Str::lit(""))
}

pub fn f44(v0: Bytes, v1: Bytes) -> bool {
    let a267 = {
        let a263 = v0;
        let a264 = v1;
        compare_bytes(a263, a264)
    };
    let a268 = {
        let a265 = Bytes::lit(&[0x00]);
        let a266 = Bytes::lit(&[0x00]);
        compare_bytes(a265, a266)
    };
    equal(a267, a268)
}

pub fn f45(v0: Bytes, v1: Bytes, v2: u64, v3: Bytes, v4: u64) -> R<List<Bytes>> {
    let m269 = v4;
    if m269 == 0 {
        Ok(List::cons(v3, List::<Bytes>::nil()))
    } else {
        let v5 = m269 - 1;
        if f44(f84(v0.clone(), v2, 1u64), v1.clone()) {
            Ok(List::cons(v3, f45(v0, v1, {
                let a270 = v2;
                let a271 = 1u64;
                nat_add(a270, a271)?
            }, Bytes::lit(&[]), v5)?))
        } else {
            f45(v0.clone(), v1, {
                let a272 = v2;
                let a273 = 1u64;
                nat_add(a272, a273)?
            }, {
                let a274 = v3;
                let a275 = f84(v0, v2, 1u64);
                append_bytes(a274, a275)
            }, v5)
        }
    }
}

pub fn f46(v0: u64, v1: u64) -> Str {
    let m276 = v1;
    if m276 == 0 {
        Str::lit("")
    } else {
        let v2 = m276 - 1;
        let a277 = v0;
        let a278 = 10u64;
        if nat_lt(a277, a278) {
            f94(v0)
        } else {
            f5(List::cons(f46({
                let a279 = v0;
                let a280 = 10u64;
                let a281 = 0u64;
                nat_quot(a279, a280, a281)
            }, v2), List::cons(f94({
                let a282 = v0;
                let a283 = 10u64;
                let a284 = 0u64;
                nat_rem(a282, a283, a284)
            }), List::<Str>::nil())))
        }
    }
}

pub fn f47(v0: Str, v1: Bytes) -> R<Str> {
    Ok(f48({
        let a290 = {
            let a288 = v1.clone();
            let a289 = f95({
                let a285 = v0.clone();
                utf8_encode(a285)
            }, 0u64, v1.clone(), {
                let a287 = {
                    let a286 = v0.clone();
                    utf8_encode(a286)
                };
                length_bytes(a287)
            })?;
            append_bytes(a288, a289)
        };
        let a291 = v1;
        append_bytes(a290, a291)
    }, v0))
}

pub fn f48(v0: Bytes, v1: Str) -> Str {
    let m293 = {
        let a292 = v0;
        utf8_decode(a292)
    };
    match m293 {
        None => {
            v1
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f49(v0: List<Str>) -> R<bool> {
    let m294 = v0;
    match m294.uncons() {
        None => {
            Ok(false)
        }
        Some((v1, v2)) => {
            let a295 = v1;
            let a296 = Str::lit("memory");
            if equal(a295, a296) {
                let a297 = f52(v2)?;
                let a298 = 0u64;
                Ok(nat_eq(a297, a298))
            } else {
                Ok(false)
            }
        }
    }
}

pub fn f50(v0: List<Str>, v1: List<Str>) -> List<Str> {
    let m299 = v0;
    match m299.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v2, v3)) => {
            if f23(v2.clone(), v1.clone()) {
                f50(v3, v1)
            } else {
                List::cons(v2, f50(v3, v1))
            }
        }
    }
}

pub fn f51(v0: List<Adt7>) -> List<Str> {
    let m300 = v0;
    match m300.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(match v1 {
                Adt7::C0(h301, _, _, _) => {
                    h301
                }
            }, f51(v2))
        }
    }
}

pub fn f52(v0: List<Str>) -> R<u64> {
    let m302 = v0;
    match m302.uncons() {
        None => {
            Ok(0u64)
        }
        Some((_, v2)) => {
            let a303 = f52(v2)?;
            let a304 = 1u64;
            nat_add(a303, a304)
        }
    }
}

pub fn f53(v0: List<Adt7>) -> R<u64> {
    let m305 = v0;
    match m305.uncons() {
        None => {
            Ok(0u64)
        }
        Some((_, v2)) => {
            let a306 = f53(v2)?;
            let a307 = 1u64;
            nat_add(a306, a307)
        }
    }
}

pub fn f54(v0: Adt0, v1: Adt6, v2: Str) -> R<Adt4> {
    let v3: Str = f96(v2.clone())?;
    if f97(v3.clone())? {
        if f98(v0.clone())? {
            let m310 = f99(match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h308, _, _, _) => {
                    h308
                }
            }, List::cons(match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h309, _, _, _, _, _, _, _, _) => {
                    h309
                }
            }, List::cons(Str::lit("constructor"), List::<Str>::nil())))?;
            match m310 {
                None => {
                    let m312 = match v0.clone() {
                        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h311, _, _, _) => {
                            h311
                        }
                    };
                    match m312.uncons() {
                        None => {
                            Ok(f4(Str::lit("generate.model"), Str::lit("the model document has no operations")))
                        }
                        Some((_, _)) => {
                            f100(v0.clone(), v1, v2, v3, Adt10::C1(Adt11::C0(Str::lit("1"), match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h313, _, _, _, _, _, _, _, _) => {
                                    h313
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h314, _, _, _, _, _, _, _) => {
                                    h314
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h315, _, _, _, _, _, _) => {
                                    h315
                                }
                            }, f101(match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h316, _, _, _) => {
                                    h316
                                }
                            }), f102(v0))))
                        }
                    }
                }
                Some(v4) => {
                    Ok(f4(Str::lit("generate.model"), v4))
                }
            }
        } else {
            f100(v0, v1, v2, v3, Adt10::C0)
        }
    } else {
        Ok(f4(Str::lit("generate.model"), f5(List::cons(Str::lit("the application name "), List::cons(f15(v2)?, List::cons(Str::lit(" is not one generate can turn into a class name"), List::<Str>::nil()))))))
    }
}

pub fn f55(v0: Str) -> Str {
    if f23(v0.clone(), f103()) {
        f5(List::cons(v0, List::cons(Str::lit("_"), List::<Str>::nil())))
    } else {
        v0
    }
}

pub fn f56(v0: Str) -> R<bool> {
    let v1: Bytes = {
        let a317 = v0;
        utf8_encode(a317)
    };
    let a321 = {
        let a319 = {
            let a318 = v1.clone();
            length_bytes(a318)
        };
        let a320 = 0u64;
        nat_eq(a319, a320)
    };
    if bool_not(a321) {
        let a322 = f104(f84(v1.clone(), 0u64, 1u64), f105(), 10u64);
        if bool_not(a322) {
            f106(v1.clone(), 0u64, {
                let a323 = v1;
                length_bytes(a323)
            })
        } else {
            Ok(false)
        }
    } else {
        Ok(false)
    }
}

pub fn f57(v0: Bytes, v1: u64, v2: bool, v3: u64) -> R<Bytes> {
    let m324 = v3;
    if m324 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v4 = m324 - 1;
        let v5: Bytes = f84(v0.clone(), v1, 1u64);
        if f44(v5.clone(), Bytes::lit(&[0x2d])) {
            let a327 = Bytes::lit(&[0x5f]);
            let a328 = f57(v0, {
                let a325 = v1;
                let a326 = 1u64;
                nat_add(a325, a326)?
            }, false, v4)?;
            Ok(append_bytes(a327, a328))
        } else {
            if f107(v5.clone()) {
                let a333 = if v2 {
                    let a329 = Bytes::lit(&[0x5f]);
                    let a330 = f108(v5);
                    append_bytes(a329, a330)
                } else {
                    f108(v5)
                };
                let a334 = f57(v0, {
                    let a331 = v1;
                    let a332 = 1u64;
                    nat_add(a331, a332)?
                }, false, v4)?;
                Ok(append_bytes(a333, a334))
            } else {
                let a337 = v5.clone();
                let a338 = f57(v0, {
                    let a335 = v1;
                    let a336 = 1u64;
                    nat_add(a335, a336)?
                }, f109(v5), v4)?;
                Ok(append_bytes(a337, a338))
            }
        }
    }
}

pub fn f58(v0: Str, v1: List<Adt12>) -> R<Option<(Str, Str)>> {
    let m339 = v1;
    match m339.uncons() {
        None => {
            Ok(None::<(Str, Str)>)
        }
        Some((v2, v3)) => {
            Ok(f20(f21(v0.clone(), f22(match v2 {
                Adt12::C0(h340, _, _) => {
                    h340
                }
            })?)?, f58(v0, v3)?))
        }
    }
}

pub fn f59(v0: Str, p346: List<Adt12>) -> R<Option<(Str, Str)>> {
    let m345 = p346;
    {
        let mut m345 = m345;
        loop {
            let step = {
                let v1 = m345;
                let m341 = v1;
                match m341.uncons() {
                    None => {
                        Err::<List<Adt12>, R<Option<(Str, Str)>>>(Ok(None::<(Str, Str)>))
                    }
                    Some((v2, v3)) => {
                        let v4: Str = f19(match v2.clone() {
                            Adt12::C0(h342, _, _) => {
                                h342
                            }
                        })?;
                        if if f23(v4.clone(), List::cons(v0.clone(), List::cons(Str::lit("dispatch"), List::<Str>::nil()))) {
                            true
                        } else {
                            f44(f84({
                                let a343 = v4.clone();
                                utf8_encode(a343)
                            }, 0u64, 1u64), Bytes::lit(&[0x5f]))
                        } {
                            Err::<List<Adt12>, R<Option<(Str, Str)>>>(Ok(f110(match v2 {
                                Adt12::C0(h344, _, _) => {
                                    h344
                                }
                            }, v4)))
                        } else {
                            Ok::<List<Adt12>, R<Option<(Str, Str)>>>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m345 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f60(v0: Adt9, v1: Adt11) -> Option<(Str, Str)> {
    if f111(Str::lit("unsupported-version"), match v1 {
        Adt11::C0(_, _, _, _, _, h347) => {
            h347
        }
    }) {
        None::<(Str, Str)>
    } else {
        Some((Str::lit("generate.model"), f5(List::cons(match v0 {
            Adt9::C0(h348, _, _, _, _, _, _, _) => {
                h348
            }
        }, List::cons(Str::lit("'s model has no unsupported-version error"), List::<Str>::nil())))))
    }
}

pub fn f61(v0: Str, v1: bool, v2: List<(Str, Str)>, v3: List<Adt8>) -> R<Option<(Str, Str)>> {
    let m349 = v3;
    match m349.uncons() {
        None => {
            Ok(None::<(Str, Str)>)
        }
        Some((v4, v5)) => {
            Ok(f20(if v1 {
                f21(v0.clone(), f22(match v4.clone() {
                    Adt8::C0(h350, _) => {
                        h350
                    }
                })?)?
            } else {
                None::<(Str, Str)>
            }, f20(f62(v0.clone(), match v4 {
                Adt8::C0(_, h351) => {
                    h351
                }
            }, v2.clone()), f61(v0, v1, v2, v5)?)))
        }
    }
}

pub fn f62(v0: Str, v1: Str, v2: List<(Str, Str)>) -> Option<(Str, Str)> {
    let m352 = f112(v1.clone(), v2);
    match m352 {
        None => {
            Some((Str::lit("generate.world"), f5(List::cons(Str::lit("the "), List::cons(v0, List::cons(Str::lit(" writer has no type for WIT "), List::cons(v1, List::<Str>::nil())))))))
        }
        Some(_) => {
            None::<(Str, Str)>
        }
    }
}

pub fn f63(v0: List<Str>) -> R<List<Str>> {
    let a353 = f68(f113(true, v0.clone())?);
    let a354 = f68(f113(false, v0)?);
    Ok(append_list(a353, a354))
}

pub fn f64(v0: Adt9) -> List<Str> {
    let m356 = match v0.clone() {
        Adt9::C0(_, _, _, _, _, _, _, h355) => {
            h355
        }
    };
    match m356 {
        Adt10::C0 => {
            List::cons(match v0 {
                Adt9::C0(_, h357, _, _, _, _, _, _) => {
                    h357
                }
            }, List::cons(Str::lit("MODEL"), List::<Str>::nil()))
        }
        Adt10::C1(v1) => {
            List::cons(match v0 {
                Adt9::C0(_, h358, _, _, _, _, _, _) => {
                    h358
                }
            }, List::cons(match v1.clone() {
                Adt11::C0(_, _, h359, _, _, _) => {
                    h359
                }
            }, List::cons(f5(List::cons(match v1.clone() {
                Adt11::C0(_, _, _, h360, _, _) => {
                    h360
                }
            }, List::cons(Str::lit("Code"), List::<Str>::nil()))), List::cons(match v1 {
                Adt11::C0(_, _, _, h361, _, _) => {
                    h361
                }
            }, List::cons(Str::lit("ResponseError"), List::cons(Str::lit("MODEL"), List::<Str>::nil()))))))
        }
    }
}

pub fn f65(v0: Str, v1: List<Str>, v2: Str, v3: Str) -> List<Str> {
    let v4: Str = {
        let a362 = v2.clone();
        let a363 = Str::lit("(");
        if equal(a362, a363) {
            f5(List::cons(v0.clone(), List::cons({
                let a364 = v1.clone();
                let a365 = Str::lit(", ");
                join(a364, a365)
            }, List::<Str>::nil())))
        } else {
            f5(List::cons(v0.clone(), List::cons(v2.clone(), List::cons({
                let a366 = v1.clone();
                let a367 = Str::lit(", ");
                join(a366, a367)
            }, List::cons(v3.clone(), List::<Str>::nil())))))
        }
    };
    if f114(v4.clone()) {
        List::cons(v4, List::<Str>::nil())
    } else {
        let a368 = List::cons(f5(List::cons(v0, List::cons(v2, List::<Str>::nil()))), f115(Str::lit("    "), v1, Str::lit(",")));
        let a369 = List::cons(v3, List::<Str>::nil());
        append_list(a368, a369)
    }
}

pub fn f66(v0: List<Str>) -> Str {
    let a372 = {
        let a370 = v0;
        let a371 = List::cons(Str::lit(""), List::<Str>::nil());
        append_list(a370, a371)
    };
    let a373 = Str::lit("\u{a}");
    join(a372, a373)
}

pub fn f67(v0: Str, v1: Str, v2: Str) -> Str {
    f5(List::cons(v0.clone(), List::cons(Str::lit(" Generated by `"), List::cons(v1.clone(), List::cons(Str::lit("` from "), List::cons(v2, List::cons(Str::lit(".\u{a}"), List::cons(v0, List::cons(Str::lit(" Do not edit: run `"), List::cons(v1, List::cons(Str::lit("` again.\u{a}"), List::<Str>::nil())))))))))))
}

pub fn f68(v0: List<Str>) -> List<Str> {
    let m374 = v0;
    match m374.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            f116(v1, f68(v2))
        }
    }
}

pub fn f69(v0: Str, v1: Str) -> bool {
    let a381 = {
        let a377 = {
            let a375 = v0;
            utf8_encode(a375)
        };
        let a378 = {
            let a376 = v1;
            utf8_encode(a376)
        };
        compare_bytes(a377, a378)
    };
    let a382 = {
        let a379 = Bytes::lit(&[0x00]);
        let a380 = Bytes::lit(&[0x01]);
        compare_bytes(a379, a380)
    };
    equal(a381, a382)
}

pub fn f70(v0: List<Str>) -> R<List<Str>> {
    let m383 = v0;
    match m383.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            Ok(List::cons(f15(v1)?, f70(v2)?))
        }
    }
}

pub fn f71(v0: Adt6) -> Str {
    f5(List::cons(Str::lit("the WIT world "), List::cons(match v0.clone() {
        Adt6::C0(h384, _, _, _, _, _, _, _, _) => {
            h384
        }
    }, List::cons(Str::lit(" ("), List::cons(match v0 {
        Adt6::C0(_, _, _, h385, _, _, _, _, _) => {
            h385
        }
    }, List::cons(Str::lit(")"), List::<Str>::nil()))))))
}

pub fn f72(v0: List<Adt7>) -> List<Str> {
    let m386 = v0;
    match m386.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(match v1 {
                Adt7::C0(h387, _, _, _) => {
                    h387
                }
            }, f72(v2))
        }
    }
}

pub fn f73(v0: List<Adt7>) -> R<List<Str>> {
    let m388 = v0;
    match m388.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            let a399 = List::cons(Str::lit(""), List::cons(f5(List::cons(Str::lit("    def "), List::cons(f55(match v1.clone() {
                Adt7::C0(h389, _, _, _) => {
                    h389
                }
            }), List::cons(Str::lit("(self"), List::cons(f117(match v1.clone() {
                Adt7::C0(_, h390, _, _) => {
                    h390
                }
            })?, List::cons(Str::lit(") -> "), List::cons({
                let m392 = match v1.clone() {
                    Adt7::C0(_, _, h391, _) => {
                        h391
                    }
                };
                match m392 {
                    None => {
                        Str::lit("None")
                    }
                    Some(v3) => {
                        f118(v3)
                    }
                }
            }, List::cons(Str::lit(":"), List::<Str>::nil())))))))), List::<Str>::nil()));
            let a400 = {
                let a397 = f76(Str::lit("        "), {
                    let m394 = match v1.clone() {
                        Adt7::C0(_, _, _, h393) => {
                            h393
                        }
                    };
                    match m394.uncons() {
                        None => {
                            List::cons(f5(List::cons(Str::lit("The export "), List::cons(match v1 {
                                Adt7::C0(h395, _, _, _) => {
                                    h395
                                }
                            }, List::cons(Str::lit("."), List::<Str>::nil())))), List::<Str>::nil())
                        }
                        Some((_, _)) => {
                            match v1 {
                                Adt7::C0(_, _, _, h396) => {
                                    h396
                                }
                            }
                        }
                    }
                })?;
                let a398 = List::cons(Str::lit("        ..."), f73(v2)?);
                append_list(a397, a398)
            };
            Ok(append_list(a399, a400))
        }
    }
}

pub fn f74() -> Str {
    Str::lit("class DispatchError(Exception):\u{a}    \"\"\"A request did not come back from the guest.\"\"\"\u{a}\u{a}\u{a}def dispatch(guest: Guest, request: bytes) -> bytes:\u{a}    \"\"\"Send one request to a fresh instance of the guest and return a copy of its response.\u{a}\u{a}    The guest allocator never frees, so give every request its own instance.\u{a}    \"\"\"\u{a}    if len(request) > 0xFFFF_FFFF:\u{a}        raise DispatchError(f\"a request of {len(request)} bytes is too long\")\u{a}    offset = guest.holo_alloc(len(request))\u{a}    guest.write_memory(offset, bytes(request))\u{a}    packed = guest.holo_run(offset, len(request))\u{a}    # The response location is packed as `offset << 32 | length`.\u{a}    return bytes(guest.read_memory(packed >> 32, packed & 0xFFFF_FFFF))")
}

pub fn f75(v0: Adt9) -> Str {
    f5(List::cons(match v0.clone() {
        Adt9::C0(h401, _, _, _, _, _, _, _) => {
            h401
        }
    }, List::cons(Str::lit("'s model ("), List::cons(match v0.clone() {
        Adt9::C0(_, _, _, _, h402, _, _, _) => {
            h402
        }
    }, List::cons(Str::lit(", blake3:"), List::cons(match v0 {
        Adt9::C0(_, _, _, _, _, h403, _, _) => {
            h403
        }
    }, List::cons(Str::lit(")"), List::<Str>::nil())))))))
}

pub fn f76(v0: Str, v1: List<Str>) -> R<List<Str>> {
    let m404 = v1;
    match m404.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v2, v3)) => {
            let m405 = v3.clone();
            match m405.uncons() {
                None => {
                    Ok(List::cons(f5(List::cons(v0, List::cons(Str::lit("\"\"\""), List::cons(f119(v2)?, List::cons(Str::lit("\"\"\""), List::<Str>::nil()))))), List::<Str>::nil()))
                }
                Some((_, _)) => {
                    Ok(List::cons(f5(List::cons(v0.clone(), List::cons(Str::lit("\"\"\""), List::cons(f119(v2)?, List::<Str>::nil())))), {
                        let a406 = f120(v0.clone(), v3)?;
                        let a407 = List::cons(f5(List::cons(v0, List::cons(Str::lit("\"\"\""), List::<Str>::nil()))), List::<Str>::nil());
                        append_list(a406, a407)
                    }))
                }
            }
        }
    }
}

pub fn f77(v0: Adt9, v1: Str) -> List<Str> {
    let m409 = match v0 {
        Adt9::C0(_, _, _, h408, _, _, _, _) => {
            h408
        }
    };
    match m409 {
        None => {
            List::cons(v1, List::<Str>::nil())
        }
        Some(v2) => {
            List::cons(v1, List::cons(Str::lit(""), List::cons(v2, List::<Str>::nil())))
        }
    }
}

pub fn f78(v0: List<Adt12>) -> R<List<Str>> {
    let m410 = v0;
    match m410.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            Ok(List::cons(f5(List::cons(Str::lit("    "), List::cons(f121(match v1.clone() {
                Adt12::C0(h411, _, _) => {
                    h411
                }
            })?, List::cons(Str::lit(" = "), List::cons(f15(match v1.clone() {
                Adt12::C0(h412, _, _) => {
                    h412
                }
            })?, List::cons(Str::lit("\u{a}    \"\"\""), List::cons(match v1 {
                Adt12::C0(_, h413, _) => {
                    h413
                }
            }, List::cons(Str::lit(".\"\"\""), List::<Str>::nil())))))))), f78(v2)?))
        }
    }
}

pub fn f79(v0: Adt9, v1: Str, v2: List<Adt13>) -> R<List<Str>> {
    let m414 = v2;
    match m414.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v3, v4)) => {
            Ok(List::cons(f5(List::cons(Str::lit("    "), List::cons(f121(match v3.clone() {
                Adt13::C0(h415, _) => {
                    h415
                }
            })?, List::cons(Str::lit(" = "), List::cons(f15(match v3.clone() {
                Adt13::C0(h416, _) => {
                    h416
                }
            })?, List::cons(Str::lit("\u{a}    \"\"\""), List::cons(f122(f123(v0.clone(), v1.clone(), v3))?, List::cons(Str::lit("\"\"\""), List::<Str>::nil())))))))), f79(v0, v1, v4)?))
        }
    }
}

pub fn f80(v0: Adt9, v1: Str, v2: Str, v3: List<Adt13>) -> R<List<Str>> {
    let m417 = v3;
    match m417.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v4, v5)) => {
            Ok(List::cons(f5(List::cons(Str::lit("    "), List::cons(v2.clone(), List::cons(Str::lit("."), List::cons(f121(match v4.clone() {
                Adt13::C0(h418, _) => {
                    h418
                }
            })?, List::cons(Str::lit(": "), List::cons(f15(f123(v0.clone(), v1.clone(), v4))?, List::cons(Str::lit(","), List::<Str>::nil())))))))), f80(v0, v1, v2, v5)?))
        }
    }
}

pub fn f81(v0: Str, v1: Str, v2: List<Adt12>) -> R<List<Str>> {
    let m419 = v2;
    match m419.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v3, v4)) => {
            let v5: Str = f121(match v3.clone() {
                Adt12::C0(h420, _, _) => {
                    h420
                }
            })?;
            Ok(List::cons(f5(List::cons(Str::lit("\u{a}    def "), List::cons(f19(match v3.clone() {
                Adt12::C0(h421, _, _) => {
                    h421
                }
            })?, List::cons(Str::lit("(self, left: int, right: int) -> int:\u{a}        \"\"\""), List::cons(match v3 {
                Adt12::C0(_, h422, _) => {
                    h422
                }
            }, List::cons(Str::lit(": `"), List::cons(v0.clone(), List::cons(Str::lit("("), List::cons(v1.clone(), List::cons(Str::lit("."), List::cons(v5.clone(), List::cons(Str::lit(", left, right)`.\"\"\"\u{a}        return self."), List::cons(v0.clone(), List::cons(Str::lit("("), List::cons(v1.clone(), List::cons(Str::lit("."), List::cons(v5, List::cons(Str::lit(", left, right)"), List::<Str>::nil())))))))))))))))))), f81(v0, v1, v4)?))
        }
    }
}

pub fn f82(v0: Bytes, p427: u64, p428: u64) -> R<u64> {
    let m426 = (p427, p428);
    {
        let mut m426 = m426;
        loop {
            let step = {
                let (v1, v2) = m426;
                let m423 = v2;
                if m423 == 0 {
                    Err::<(u64, u64), R<u64>>(Ok(v1))
                } else {
                    let v3 = m423 - 1;
                    if f124(f84(v0.clone(), v1, 1u64)) {
                        Ok::<(u64, u64), R<u64>>(({
                            let a424 = v1;
                            let a425 = 1u64;
                            nat_add(a424, a425)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<u64>>(Ok(v1))
                    }
                }
            };
            match step {
                Ok(next) => { m426 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f83(v0: Bytes, p435: u64, p436: u64, p437: u64) -> R<u64> {
    let m434 = (p435, (p436, p437));
    {
        let mut m434 = m434;
        loop {
            let step = {
                let (v1, (v2, v3)) = m434;
                let m429 = v2;
                if m429 == 0 {
                    Err::<(u64, (u64, u64)), R<u64>>(Ok(v3))
                } else {
                    let v4 = m429 - 1;
                    Ok::<(u64, (u64, u64)), R<u64>>(({
                        let a430 = v1;
                        let a431 = 1u64;
                        nat_add(a430, a431)?
                    }, (v4, if f124(f84(v0.clone(), v1, 1u64)) {
                        v3
                    } else {
                        let a432 = v1;
                        let a433 = 1u64;
                        nat_add(a432, a433)?
                    })))
                }
            };
            match step {
                Ok(next) => { m434 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f84(v0: Bytes, v1: u64, v2: u64) -> Bytes {
    let m441 = {
        let a438 = v0;
        let a439 = v1;
        let a440 = v2;
        slice_bytes(a438, a439, a440)
    };
    match m441 {
        None => {
            Bytes::lit(&[])
        }
        Some(v3) => {
            v3
        }
    }
}

pub fn f85(v0: u64, v1: u64) -> R<u64> {
    f125(v0, v1, 0u64, {
        let a442 = v0;
        let a443 = 1u64;
        nat_add(a442, a443)?
    })
}

pub fn f86(v0: Bytes, v1: Bytes, p448: u64, p449: u64) -> R<Option<u64>> {
    let m447 = (p448, p449);
    {
        let mut m447 = m447;
        loop {
            let step = {
                let (v2, v3) = m447;
                let m444 = v3;
                if m444 == 0 {
                    Err::<(u64, u64), R<Option<u64>>>(Ok(None::<u64>))
                } else {
                    let v4 = m444 - 1;
                    if f44(f84(v0.clone(), v2, 1u64), v1.clone()) {
                        Err::<(u64, u64), R<Option<u64>>>(Ok(Some(v2)))
                    } else {
                        Ok::<(u64, u64), R<Option<u64>>>(({
                            let a445 = v2;
                            let a446 = 1u64;
                            nat_add(a445, a446)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m447 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f87(v0: Bytes) -> R<bool> {
    let m450 = f86(v0.clone(), Bytes::lit(&[0x40]), 0u64, f3(v0.clone()))?;
    match m450 {
        None => {
            f41(v0)
        }
        Some(v1) => {
            if f41(f84(v0.clone(), 0u64, v1))? {
                let a455 = {
                    let a453 = f3(v0.clone());
                    let a454 = {
                        let a451 = v1;
                        let a452 = 1u64;
                        nat_add(a451, a452)?
                    };
                    nat_eq(a453, a454)
                };
                if bool_not(a455) {
                    f126(f36(v0.clone(), {
                        let a456 = v1;
                        let a457 = 1u64;
                        nat_add(a456, a457)?
                    }, 0u64)?, 0u64, f85(f3(v0), {
                        let a458 = v1;
                        let a459 = 1u64;
                        nat_add(a458, a459)?
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

pub fn f88(v0: Bytes) -> bool {
    f104(v0, f127(), 26u64)
}

pub fn f89(v0: Bytes, p467: u64, p468: u64, p469: bool) -> R<bool> {
    let m466 = (p467, (p468, p469));
    {
        let mut m466 = m466;
        loop {
            let step = {
                let (v1, (v2, v3)) = m466;
                let m460 = v2;
                if m460 == 0 {
                    let a461 = v3;
                    Err::<(u64, (u64, bool)), R<bool>>(Ok(bool_not(a461)))
                } else {
                    let v4 = m460 - 1;
                    if f44(f84(v0.clone(), v1, 1u64), Bytes::lit(&[0x2d])) {
                        if v3 {
                            Err::<(u64, (u64, bool)), R<bool>>(Ok(false))
                        } else {
                            Ok::<(u64, (u64, bool)), R<bool>>(({
                                let a462 = v1;
                                let a463 = 1u64;
                                nat_add(a462, a463)?
                            }, (v4, true)))
                        }
                    } else {
                        if if f88(f84(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            f128(f84(v0.clone(), v1, 1u64))
                        } {
                            Ok::<(u64, (u64, bool)), R<bool>>(({
                                let a464 = v1;
                                let a465 = 1u64;
                                nat_add(a464, a465)?
                            }, (v4, false)))
                        } else {
                            Err::<(u64, (u64, bool)), R<bool>>(Ok(false))
                        }
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

pub fn f90() -> List<Str> {
    List::cons(Str::lit("bool"), List::cons(Str::lit("u8"), List::cons(Str::lit("s8"), List::cons(Str::lit("u16"), List::cons(Str::lit("s16"), List::cons(Str::lit("u32"), List::cons(Str::lit("s32"), List::cons(Str::lit("char"), List::cons(Str::lit("u64"), List::cons(Str::lit("s64"), List::cons(Str::lit("f32"), List::cons(Str::lit("f64"), List::<Str>::nil()))))))))))))
}

pub fn f91(v0: Bytes) -> R<Adt17> {
    let a470 = f3(f34(v0.clone())?);
    let a471 = 0u64;
    if nat_eq(a470, a471) {
        Ok(Adt17::C0(List::<Adt8>::nil()))
    } else {
        f129(f13(v0, Bytes::lit(&[0x2c]))?)
    }
}

pub fn f92(v0: Bytes) -> R<Str> {
    Ok(f16(f130(v0.clone(), 0u64, f3(v0))?))
}

pub fn f93(v0: Bytes) -> Str {
    f5(List::cons(Str::lit("type "), List::cons(f16(v0), List::cons(Str::lit(" is outside the scalar subset generate reads"), List::<Str>::nil()))))
}

pub fn f94(v0: u64) -> Str {
    f48(f84(f105(), v0, 1u64), Str::lit("0"))
}

pub fn f95(v0: Bytes, v1: u64, v2: Bytes, v3: u64) -> R<Bytes> {
    let m472 = v3;
    if m472 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v4 = m472 - 1;
        let a477 = if f44(f84(v0.clone(), v1, 1u64), Bytes::lit(&[0x5c])) {
            Bytes::lit(&[0x5c, 0x5c])
        } else {
            if f44(f84(v0.clone(), v1, 1u64), v2.clone()) {
                let a473 = Bytes::lit(&[0x5c]);
                let a474 = v2.clone();
                append_bytes(a473, a474)
            } else {
                if f44(f84(v0.clone(), v1, 1u64), Bytes::lit(&[0x0a])) {
                    Bytes::lit(&[0x5c, 0x6e])
                } else {
                    f84(v0.clone(), v1, 1u64)
                }
            }
        };
        let a478 = f95(v0, {
            let a475 = v1;
            let a476 = 1u64;
            nat_add(a475, a476)?
        }, v2, v4)?;
        Ok(append_bytes(a477, a478))
    }
}

pub fn f96(v0: Str) -> R<Str> {
    Ok(f48(f131({
        let a479 = v0.clone();
        utf8_encode(a479)
    }, 0u64, true, {
        let a481 = {
            let a480 = v0.clone();
            utf8_encode(a480)
        };
        length_bytes(a481)
    })?, v0))
}

pub fn f97(v0: Str) -> R<bool> {
    let v1: Bytes = {
        let a482 = v0;
        utf8_encode(a482)
    };
    if f132(f84(v1.clone(), 0u64, 1u64)) {
        f133(v1.clone(), 0u64, f3(v1))
    } else {
        Ok(false)
    }
}

pub fn f98(v0: Adt0) -> R<bool> {
    let a484 = match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h483, _, _, _, _, _, _, _, _, _, _) => {
            h483
        }
    };
    let a485 = Str::lit("prismpm/model-document/1");
    if equal(a484, a485) {
        if f39({
            let a487 = match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h486, _, _, _, _, _, _, _, _, _) => {
                    h486
                }
            };
            utf8_encode(a487)
        }, Bytes::lit(&[0x41, 0x73, 0x63, 0x69, 0x69, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x49, 0x36, 0x34]))? {
            Ok(true)
        } else {
            f39({
                let a489 = match v0 {
                    Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h488, _, _, _, _, _, _, _, _, _) => {
                        h488
                    }
                };
                utf8_encode(a489)
            }, Bytes::lit(&[0x41, 0x73, 0x63, 0x69, 0x69, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x49, 0x6e, 0x74, 0x36, 0x34]))
        }
    } else {
        Ok(false)
    }
}

pub fn f99(p498: List<Adt1>, p499: List<Str>) -> R<Option<Str>> {
    let m497 = (p498, p499);
    {
        let mut m497 = m497;
        loop {
            let step = {
                let (v0, v1) = m497;
                let m490 = v0;
                match m490.uncons() {
                    None => {
                        Err::<(List<Adt1>, List<Str>), R<Option<Str>>>(Ok(None::<Str>))
                    }
                    Some((v2, v3)) => {
                        if f134(match v2.clone() {
                            Adt1::C0(h491, _, _) => {
                                h491
                            }
                        })? {
                            if f23(f135(match v2.clone() {
                                Adt1::C0(h492, _, _) => {
                                    h492
                                }
                            })?, v1.clone()) {
                                Err::<(List<Adt1>, List<Str>), R<Option<Str>>>(Ok(Some(f5(List::cons(Str::lit("operation "), List::cons(match v2.clone() {
                                    Adt1::C0(h493, _, _) => {
                                        h493
                                    }
                                }, List::cons(Str::lit(" collides with the method "), List::cons(f135(match v2 {
                                    Adt1::C0(h494, _, _) => {
                                        h494
                                    }
                                })?, List::<Str>::nil()))))))))
                            } else {
                                Ok::<(List<Adt1>, List<Str>), R<Option<Str>>>((v3, List::cons(f135(match v2 {
                                    Adt1::C0(h495, _, _) => {
                                        h495
                                    }
                                })?, v1)))
                            }
                        } else {
                            Err::<(List<Adt1>, List<Str>), R<Option<Str>>>(Ok(Some(f5(List::cons(Str::lit("operation "), List::cons(f15(match v2 {
                                Adt1::C0(h496, _, _) => {
                                    h496
                                }
                            })?, List::cons(Str::lit(" is not a request name generate can bind"), List::<Str>::nil())))))))
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m497 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f100(v0: Adt0, v1: Adt6, v2: Str, v3: Str, v4: Adt10) -> R<Adt4> {
    Ok(Adt4::C0(Adt5::C0(match v0.clone() {
        Adt0::C0(h500, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h500
        }
    }, v1, Adt9::C0(v2, v3.clone(), f136(v3)?, match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h501, _, _, _, _, _, _, _, _, _, _, _) => {
            h501
        }
    }, match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h502, _, _, _, _, _, _, _, _, _, _) => {
            h502
        }
    }, match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h503, _, _, _, _, _) => {
            h503
        }
    }, match v0 {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h504, _, _, _, _) => {
            h504
        }
    }, v4))))
}

pub fn f101(v0: List<Adt1>) -> List<Adt12> {
    let m505 = v0;
    match m505.uncons() {
        None => {
            List::<Adt12>::nil()
        }
        Some((v1, v2)) => {
            List::cons(Adt12::C0(match v1.clone() {
                Adt1::C0(h506, _, _) => {
                    h506
                }
            }, match v1.clone() {
                Adt1::C0(_, h507, _) => {
                    h507
                }
            }, match v1 {
                Adt1::C0(_, _, h508) => {
                    h508
                }
            }), f101(v2))
        }
    }
}

pub fn f102(v0: Adt0) -> List<Adt13> {
    List::cons(Adt13::C0(Str::lit("overflow"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h509, _, _) => {
            h509
        }
    }), List::cons(Adt13::C0(Str::lit("division-by-zero"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h510, _) => {
            h510
        }
    }), List::cons(Adt13::C0(Str::lit("malformed-request"), match v0 {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h511) => {
            h511
        }
    }), List::cons(Adt13::C0(Str::lit("unsupported-version"), None::<Str>), List::cons(Adt13::C0(Str::lit("unknown-operation"), None::<Str>), List::<Adt13>::nil())))))
}

pub fn f103() -> List<Str> {
    List::cons(Str::lit("False"), List::cons(Str::lit("None"), List::cons(Str::lit("True"), List::cons(Str::lit("and"), List::cons(Str::lit("as"), List::cons(Str::lit("assert"), List::cons(Str::lit("async"), List::cons(Str::lit("await"), List::cons(Str::lit("break"), List::cons(Str::lit("class"), List::cons(Str::lit("continue"), List::cons(Str::lit("def"), List::cons(Str::lit("del"), List::cons(Str::lit("elif"), List::cons(Str::lit("else"), List::cons(Str::lit("except"), List::cons(Str::lit("finally"), List::cons(Str::lit("for"), List::cons(Str::lit("from"), List::cons(Str::lit("global"), List::cons(Str::lit("if"), List::cons(Str::lit("import"), List::cons(Str::lit("in"), List::cons(Str::lit("is"), List::cons(Str::lit("lambda"), List::cons(Str::lit("nonlocal"), List::cons(Str::lit("not"), List::cons(Str::lit("or"), List::cons(Str::lit("pass"), List::cons(Str::lit("raise"), List::cons(Str::lit("return"), List::cons(Str::lit("try"), List::cons(Str::lit("while"), List::cons(Str::lit("with"), List::cons(Str::lit("yield"), List::cons(Str::lit("match"), List::cons(Str::lit("case"), List::cons(Str::lit("type"), List::<Str>::nil()))))))))))))))))))))))))))))))))))))))
}

pub fn f104(v0: Bytes, v1: Bytes, p514: u64) -> bool {
    let m513 = p514;
    {
        let mut m513 = m513;
        loop {
            let step = {
                let v2 = m513;
                let m512 = v2;
                if m512 == 0 {
                    Err::<u64, bool>(false)
                } else {
                    let v3 = m512 - 1;
                    if f44(f84(v1.clone(), v3, 1u64), v0.clone()) {
                        Err::<u64, bool>(true)
                    } else {
                        Ok::<u64, bool>(v3)
                    }
                }
            };
            match step {
                Ok(next) => { m513 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f105() -> Bytes {
    Bytes::lit(&[0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39])
}

pub fn f106(v0: Bytes, p519: u64, p520: u64) -> R<bool> {
    let m518 = (p519, p520);
    {
        let mut m518 = m518;
        loop {
            let step = {
                let (v1, v2) = m518;
                let m515 = v2;
                if m515 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m515 - 1;
                    if if f109(f84(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        f44(f84(v0.clone(), v1, 1u64), Bytes::lit(&[0x5f]))
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a516 = v1;
                            let a517 = 1u64;
                            nat_add(a516, a517)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m518 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f107(v0: Bytes) -> bool {
    let a521 = f44(f108(v0.clone()), v0);
    bool_not(a521)
}

pub fn f108(v0: Bytes) -> Bytes {
    f137(v0, f138(), f127(), 26u64)
}

pub fn f109(v0: Bytes) -> bool {
    if f104(v0.clone(), f127(), 26u64) {
        true
    } else {
        f104(v0, f105(), 10u64)
    }
}

pub fn f110(v0: Str, v1: Str) -> Option<(Str, Str)> {
    Some((Str::lit("generate.model"), f5(List::cons(Str::lit("operation "), List::cons(v0, List::cons(Str::lit(" collides with the method "), List::cons(v1, List::<Str>::nil())))))))
}

pub fn f111(v0: Str, p527: List<Adt13>) -> bool {
    let m526 = p527;
    {
        let mut m526 = m526;
        loop {
            let step = {
                let v1 = m526;
                let m522 = v1;
                match m522.uncons() {
                    None => {
                        Err::<List<Adt13>, bool>(false)
                    }
                    Some((v2, v3)) => {
                        let a524 = match v2 {
                            Adt13::C0(h523, _) => {
                                h523
                            }
                        };
                        let a525 = v0.clone();
                        if equal(a524, a525) {
                            Err::<List<Adt13>, bool>(true)
                        } else {
                            Ok::<List<Adt13>, bool>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m526 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f112(v0: Str, p534: List<(Str, Str)>) -> Option<Str> {
    let m533 = p534;
    {
        let mut m533 = m533;
        loop {
            let step = {
                let v1 = m533;
                let m528 = v1;
                match m528.uncons() {
                    None => {
                        Err::<List<(Str, Str)>, Option<Str>>(None::<Str>)
                    }
                    Some((v2, v3)) => {
                        let a530 = {
                            let (h529, _) = v2;
                            h529
                        };
                        let a531 = v0.clone();
                        if equal(a530, a531) {
                            Err::<List<(Str, Str)>, Option<Str>>(Some({
                                let (_, h532) = v2;
                                h532
                            }))
                        } else {
                            Ok::<List<(Str, Str)>, Option<Str>>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m533 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f113(v0: bool, v1: List<Str>) -> R<List<Str>> {
    let m535 = v1;
    match m535.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v2, v3)) => {
            let a536 = f139(v2.clone())?;
            let a537 = v0;
            if equal(a536, a537) {
                Ok(List::cons(v2, f113(v0, v3)?))
            } else {
                f113(v0, v3)
            }
        }
    }
}

pub fn f114(v0: Str) -> bool {
    let a539 = {
        let a538 = v0;
        length_string(a538)
    };
    let a540 = 100u64;
    nat_le(a539, a540)
}

pub fn f115(v0: Str, v1: List<Str>, v2: Str) -> List<Str> {
    let m541 = v1;
    match m541.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v3, v4)) => {
            List::cons(f5(List::cons(v0.clone(), List::cons(v3, List::cons(v2.clone(), List::<Str>::nil())))), f115(v0, v4, v2))
        }
    }
}

pub fn f116(v0: Str, v1: List<Str>) -> List<Str> {
    let m542 = v1;
    match m542.uncons() {
        None => {
            List::cons(v0, List::<Str>::nil())
        }
        Some((v2, v3)) => {
            if f69(v0.clone(), v2.clone()) {
                List::cons(v0, List::cons(v2, v3))
            } else {
                List::cons(v2, f116(v0, v3))
            }
        }
    }
}

pub fn f117(v0: List<Adt8>) -> R<Str> {
    let m543 = v0;
    match m543.uncons() {
        None => {
            Ok(Str::lit(""))
        }
        Some((v1, v2)) => {
            Ok(f5(List::cons(Str::lit(", "), List::cons(f19(match v1.clone() {
                Adt8::C0(h544, _) => {
                    h544
                }
            })?, List::cons(Str::lit(": "), List::cons(f118(match v1 {
                Adt8::C0(_, h545) => {
                    h545
                }
            }), List::cons(f117(v2)?, List::<Str>::nil())))))))
        }
    }
}

pub fn f118(v0: Str) -> Str {
    let m546 = f112(v0.clone(), f27());
    match m546 {
        None => {
            v0
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f119(v0: Str) -> R<Str> {
    let v1: Bytes = {
        let a547 = v0.clone();
        utf8_encode(a547)
    };
    Ok(f48(f140(v1.clone(), 0u64, {
        let a548 = v1;
        length_bytes(a548)
    })?, v0))
}

pub fn f120(v0: Str, v1: List<Str>) -> R<List<Str>> {
    let m549 = v1;
    match m549.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v2, v3)) => {
            Ok(List::cons({
                let a550 = v2.clone();
                let a551 = Str::lit("");
                if equal(a550, a551) {
                    Str::lit("")
                } else {
                    f5(List::cons(v0.clone(), List::cons(f119(v2)?, List::<Str>::nil())))
                }
            }, f120(v0, v3)?))
        }
    }
}

pub fn f121(v0: Str) -> R<Str> {
    let v1: Bytes = {
        let a552 = f22(v0.clone())?;
        utf8_encode(a552)
    };
    Ok(f48(f141(v1.clone(), 0u64, {
        let a553 = v1;
        length_bytes(a553)
    })?, v0))
}

pub fn f122(v0: Str) -> R<Str> {
    let v1: Bytes = {
        let a554 = v0.clone();
        utf8_encode(a554)
    };
    Ok(f48(f142(v1.clone(), 0u64, {
        let a555 = v1;
        length_bytes(a555)
    })?, v0))
}

pub fn f123(v0: Adt9, v1: Str, v2: Adt13) -> Str {
    let m557 = match v2.clone() {
        Adt13::C0(_, h556) => {
            h556
        }
    };
    match m557 {
        None => {
            let a559 = match v2.clone() {
                Adt13::C0(h558, _) => {
                    h558
                }
            };
            let a560 = Str::lit("unsupported-version");
            if equal(a559, a560) {
                f5(List::cons(match v0 {
                    Adt9::C0(h561, _, _, _, _, _, _, _) => {
                        h561
                    }
                }, List::cons(Str::lit(" does not answer request version "), List::cons(v1, List::cons(Str::lit("."), List::<Str>::nil())))))
            } else {
                let a563 = match v2.clone() {
                    Adt13::C0(h562, _) => {
                        h562
                    }
                };
                let a564 = Str::lit("unknown-operation");
                if equal(a563, a564) {
                    f5(List::cons(match v0 {
                        Adt9::C0(h565, _, _, _, _, _, _, _) => {
                            h565
                        }
                    }, List::cons(Str::lit(" does not know this operation."), List::<Str>::nil())))
                } else {
                    f5(List::cons(match v0 {
                        Adt9::C0(h566, _, _, _, _, _, _, _) => {
                            h566
                        }
                    }, List::cons(Str::lit(" refused the request: "), List::cons(match v2 {
                        Adt13::C0(h567, _) => {
                            h567
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

pub fn f124(v0: Bytes) -> bool {
    f104(v0, Bytes::lit(&[0x20, 0x09, 0x0d]), 3u64)
}

pub fn f125(v0: u64, v1: u64, p576: u64, p577: u64) -> R<u64> {
    let m575 = (p576, p577);
    {
        let mut m575 = m575;
        loop {
            let step = {
                let (v2, v3) = m575;
                let m568 = v3;
                if m568 == 0 {
                    Err::<(u64, u64), R<u64>>(Ok(0u64))
                } else {
                    let v4 = m568 - 1;
                    let a571 = {
                        let a569 = v2;
                        let a570 = v1;
                        nat_add(a569, a570)?
                    };
                    let a572 = v0;
                    if nat_eq(a571, a572) {
                        Err::<(u64, u64), R<u64>>(Ok(v2))
                    } else {
                        Ok::<(u64, u64), R<u64>>(({
                            let a573 = v2;
                            let a574 = 1u64;
                            nat_add(a573, a574)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m575 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f126(v0: Bytes, p582: u64, p583: u64) -> R<bool> {
    let m581 = (p582, p583);
    {
        let mut m581 = m581;
        loop {
            let step = {
                let (v1, v2) = m581;
                let m578 = v2;
                if m578 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m578 - 1;
                    if if f88(f84(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        if f132(f84(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            if f128(f84(v0.clone(), v1, 1u64)) {
                                true
                            } else {
                                f104(f84(v0.clone(), v1, 1u64), Bytes::lit(&[0x2e, 0x2b, 0x2d]), 3u64)
                            }
                        }
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a579 = v1;
                            let a580 = 1u64;
                            nat_add(a579, a580)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m581 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f127() -> Bytes {
    Bytes::lit(&[0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a])
}

pub fn f128(v0: Bytes) -> bool {
    f104(v0, f105(), 10u64)
}

pub fn f129(v0: List<Bytes>) -> R<Adt17> {
    let m584 = v0;
    match m584.uncons() {
        None => {
            Ok(Adt17::C0(List::<Adt8>::nil()))
        }
        Some((v1, v2)) => {
            let v3: Bytes = f34(v1)?;
            let m585 = f86(v3.clone(), Bytes::lit(&[0x3a]), 0u64, f3(v3.clone()))?;
            match m585 {
                None => {
                    Ok(Adt17::C1(f5(List::cons(Str::lit("cannot read parameter "), List::cons(f15(f16(v3))?, List::<Str>::nil())))))
                }
                Some(v4) => {
                    let v5: Bytes = f84(v3.clone(), 0u64, v4);
                    let v6: Bytes = f36(v3.clone(), {
                        let a586 = v4;
                        let a587 = 2u64;
                        nat_add(a586, a587)?
                    }, 0u64)?;
                    if if f44(f84(v3.clone(), {
                        let a588 = v4;
                        let a589 = 1u64;
                        nat_add(a588, a589)?
                    }, 1u64), Bytes::lit(&[0x20])) {
                        if f41(v5.clone())? {
                            f41(v6.clone())?
                        } else {
                            false
                        }
                    } else {
                        false
                    } {
                        if f23(f16(v6.clone()), f90()) {
                            let m590 = f129(v2)?;
                            match m590 {
                                Adt17::C0(v7) => {
                                    Ok(Adt17::C0(List::cons(Adt8::C0(f16(v5), f16(v6)), v7)))
                                }
                                Adt17::C1(v8) => {
                                    Ok(Adt17::C1(v8))
                                }
                            }
                        } else {
                            Ok(Adt17::C1(f93(v6)))
                        }
                    } else {
                        Ok(Adt17::C1(f5(List::cons(Str::lit("cannot read parameter "), List::cons(f15(f16(v3))?, List::<Str>::nil())))))
                    }
                }
            }
        }
    }
}

pub fn f130(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let m591 = v2;
    if m591 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v3 = m591 - 1;
        let a594 = if f44(f84(v0.clone(), v1, 1u64), Bytes::lit(&[0x2d])) {
            Bytes::lit(&[0x5f])
        } else {
            f84(v0.clone(), v1, 1u64)
        };
        let a595 = f130(v0, {
            let a592 = v1;
            let a593 = 1u64;
            nat_add(a592, a593)?
        }, v3)?;
        Ok(append_bytes(a594, a595))
    }
}

pub fn f131(v0: Bytes, v1: u64, v2: bool, v3: u64) -> R<Bytes> {
    let m596 = v3;
    if m596 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v4 = m596 - 1;
        if f143(f84(v0.clone(), v1, 1u64)) {
            f131(v0, {
                let a597 = v1;
                let a598 = 1u64;
                nat_add(a597, a598)?
            }, true, v4)
        } else {
            let a601 = if v2 {
                f144(f84(v0.clone(), v1, 1u64))
            } else {
                f84(v0.clone(), v1, 1u64)
            };
            let a602 = f131(v0, {
                let a599 = v1;
                let a600 = 1u64;
                nat_add(a599, a600)?
            }, false, v4)?;
            Ok(append_bytes(a601, a602))
        }
    }
}

pub fn f132(v0: Bytes) -> bool {
    f104(v0, f138(), 26u64)
}

pub fn f133(v0: Bytes, p607: u64, p608: u64) -> R<bool> {
    let m606 = (p607, p608);
    {
        let mut m606 = m606;
        loop {
            let step = {
                let (v1, v2) = m606;
                let m603 = v2;
                if m603 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m603 - 1;
                    if if f88(f84(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        if f132(f84(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            f128(f84(v0.clone(), v1, 1u64))
                        }
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a604 = v1;
                            let a605 = 1u64;
                            nat_add(a604, a605)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m606 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f134(v0: Str) -> R<bool> {
    let v1: Bytes = {
        let a609 = v0;
        utf8_encode(a609)
    };
    if f88(f84(v1.clone(), 0u64, 1u64)) {
        f145(v1.clone(), 0u64, f3(v1))
    } else {
        Ok(false)
    }
}

pub fn f135(v0: Str) -> R<Str> {
    Ok(f48(f131({
        let a610 = v0.clone();
        utf8_encode(a610)
    }, 0u64, false, {
        let a612 = {
            let a611 = v0.clone();
            utf8_encode(a611)
        };
        length_bytes(a612)
    })?, v0))
}

pub fn f136(v0: Str) -> R<Str> {
    Ok(f48(f146({
        let a613 = v0.clone();
        utf8_encode(a613)
    }, 0u64, {
        let a615 = {
            let a614 = v0.clone();
            utf8_encode(a614)
        };
        length_bytes(a615)
    })?, v0))
}

pub fn f137(v0: Bytes, v1: Bytes, v2: Bytes, p618: u64) -> Bytes {
    let m617 = p618;
    {
        let mut m617 = m617;
        loop {
            let step = {
                let v3 = m617;
                let m616 = v3;
                if m616 == 0 {
                    Err::<u64, Bytes>(v0.clone())
                } else {
                    let v4 = m616 - 1;
                    if f44(f84(v1.clone(), v4, 1u64), v0.clone()) {
                        Err::<u64, Bytes>(f84(v2.clone(), v4, 1u64))
                    } else {
                        Ok::<u64, Bytes>(v4)
                    }
                }
            };
            match step {
                Ok(next) => { m617 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f138() -> Bytes {
    Bytes::lit(&[0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a])
}

pub fn f139(v0: Str) -> R<bool> {
    let v1: Bytes = {
        let a619 = v0;
        utf8_encode(a619)
    };
    let a623 = {
        let a621 = {
            let a620 = v1.clone();
            length_bytes(a620)
        };
        let a622 = 0u64;
        nat_eq(a621, a622)
    };
    if bool_not(a623) {
        f147(v1.clone(), 0u64, {
            let a624 = v1;
            length_bytes(a624)
        })
    } else {
        Ok(false)
    }
}

pub fn f140(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let m625 = v2;
    if m625 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v3 = m625 - 1;
        let a627 = {
            let a626 = v0.clone();
            length_bytes(a626)
        };
        let a628 = v1;
        if nat_le(a627, a628) {
            Ok(Bytes::lit(&[]))
        } else {
            if f44(f84(v0.clone(), v1, 3u64), Bytes::lit(&[0x22, 0x22, 0x22])) {
                let a631 = Bytes::lit(&[0x5c, 0x22, 0x5c, 0x22, 0x5c, 0x22]);
                let a632 = f140(v0, {
                    let a629 = v1;
                    let a630 = 3u64;
                    nat_add(a629, a630)?
                }, v3)?;
                Ok(append_bytes(a631, a632))
            } else {
                if f44(f84(v0.clone(), v1, 1u64), Bytes::lit(&[0x5c])) {
                    let a635 = Bytes::lit(&[0x5c, 0x5c]);
                    let a636 = f140(v0, {
                        let a633 = v1;
                        let a634 = 1u64;
                        nat_add(a633, a634)?
                    }, v3)?;
                    Ok(append_bytes(a635, a636))
                } else {
                    let a639 = f84(v0.clone(), v1, 1u64);
                    let a640 = f140(v0, {
                        let a637 = v1;
                        let a638 = 1u64;
                        nat_add(a637, a638)?
                    }, v3)?;
                    Ok(append_bytes(a639, a640))
                }
            }
        }
    }
}

pub fn f141(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let m641 = v2;
    if m641 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v3 = m641 - 1;
        let a644 = f144(f84(v0.clone(), v1, 1u64));
        let a645 = f141(v0, {
            let a642 = v1;
            let a643 = 1u64;
            nat_add(a642, a643)?
        }, v3)?;
        Ok(append_bytes(a644, a645))
    }
}

pub fn f142(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let m646 = v2;
    if m646 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v3 = m646 - 1;
        let a648 = {
            let a647 = v0.clone();
            length_bytes(a647)
        };
        let a649 = v1;
        if nat_le(a648, a649) {
            Ok(Bytes::lit(&[]))
        } else {
            if f44(f84(v0.clone(), v1, 3u64), Bytes::lit(&[0x22, 0x22, 0x22])) {
                f142(v0, {
                    let a650 = v1;
                    let a651 = 3u64;
                    nat_add(a650, a651)?
                }, v3)
            } else {
                let a654 = f84(v0.clone(), v1, 1u64);
                let a655 = f142(v0, {
                    let a652 = v1;
                    let a653 = 1u64;
                    nat_add(a652, a653)?
                }, v3)?;
                Ok(append_bytes(a654, a655))
            }
        }
    }
}

pub fn f143(v0: Bytes) -> bool {
    if f44(v0.clone(), Bytes::lit(&[0x2d])) {
        true
    } else {
        f44(v0, Bytes::lit(&[0x5f]))
    }
}

pub fn f144(v0: Bytes) -> Bytes {
    f137(v0, f127(), f138(), 26u64)
}

pub fn f145(v0: Bytes, p660: u64, p661: u64) -> R<bool> {
    let m659 = (p660, p661);
    {
        let mut m659 = m659;
        loop {
            let step = {
                let (v1, v2) = m659;
                let m656 = v2;
                if m656 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m656 - 1;
                    if if f88(f84(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        if f128(f84(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            f44(f84(v0.clone(), v1, 1u64), Bytes::lit(&[0x2d]))
                        }
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a657 = v1;
                            let a658 = 1u64;
                            nat_add(a657, a658)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m659 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f146(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let m662 = v2;
    if m662 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v3 = m662 - 1;
        if f107(f84(v0.clone(), v1, 1u64)) {
            let a669 = {
                let a663 = v1;
                let a664 = 0u64;
                if nat_eq(a663, a664) {
                    f108(f84(v0.clone(), v1, 1u64))
                } else {
                    let a665 = Bytes::lit(&[0x2d]);
                    let a666 = f108(f84(v0.clone(), v1, 1u64));
                    append_bytes(a665, a666)
                }
            };
            let a670 = f146(v0, {
                let a667 = v1;
                let a668 = 1u64;
                nat_add(a667, a668)?
            }, v3)?;
            Ok(append_bytes(a669, a670))
        } else {
            let a673 = f84(v0.clone(), v1, 1u64);
            let a674 = f146(v0, {
                let a671 = v1;
                let a672 = 1u64;
                nat_add(a671, a672)?
            }, v3)?;
            Ok(append_bytes(a673, a674))
        }
    }
}

pub fn f147(v0: Bytes, p679: u64, p680: u64) -> R<bool> {
    let m678 = (p679, p680);
    {
        let mut m678 = m678;
        loop {
            let step = {
                let (v1, v2) = m678;
                let m675 = v2;
                if m675 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m675 - 1;
                    if if f104(f84(v0.clone(), v1, 1u64), f138(), 26u64) {
                        true
                    } else {
                        if f104(f84(v0.clone(), v1, 1u64), f105(), 10u64) {
                            true
                        } else {
                            f44(f84(v0.clone(), v1, 1u64), Bytes::lit(&[0x5f]))
                        }
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a676 = v1;
                            let a677 = 1u64;
                            nat_add(a676, a677)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m678 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn run(p0: Adt0) -> R<Adt2> {
    f0(p0)
}
