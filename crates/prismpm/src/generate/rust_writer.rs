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
    Ok(f19(f20(Str::lit("rust"), f21(match v1.clone() {
        Adt9::C0(_, _, h51, _, _, _, _, _) => {
            h51
        }
    })?)?, f19({
        let a53 = f22(match v1.clone() {
            Adt9::C0(_, _, h52, _, _, _, _, _) => {
                h52
            }
        })?;
        let a54 = Str::lit("world");
        if equal(a53, a54) {
            Some((Str::lit("generate.model"), Str::lit("an application named world collides with the world module")))
        } else {
            None::<(Str, Str)>
        }
    }, f19(f23(v1)?, f19(f24(Str::lit("rust"), match v0.clone() {
        Adt5::C0(_, h55, _) => {
            h55
        }
    }), f25(Str::lit("rust"), true, f26(), {
        let m58 = match v0 {
            Adt5::C0(_, h57, _) => {
                h57
            }
        };
        match m58 {
            Adt6::C0(_, _, _, _, _, _, _, _, h56) => {
                h56
            }
        }
    })?)))))
}

pub fn f11(v0: Adt5) -> R<List<Adt3>> {
    let v1: Str = match v0.clone() {
        Adt5::C0(h59, _, _) => {
            h59
        }
    };
    let v2: Adt6 = match v0.clone() {
        Adt5::C0(_, h60, _) => {
            h60
        }
    };
    let v3: Adt9 = match v0 {
        Adt5::C0(_, _, h61) => {
            h61
        }
    };
    let v4: Str = f22(match v3.clone() {
        Adt9::C0(_, _, h62, _, _, _, _, _) => {
            h62
        }
    })?;
    Ok(List::cons(f27(Str::lit("Cargo.toml"), f28(v1.clone(), v2.clone(), v3.clone())?), List::cons(f27(Str::lit("lib.rs"), f29(v1.clone(), v2.clone(), v3.clone(), v4.clone())), List::cons(f27(Str::lit("world.rs"), f30(v1.clone(), v2)?), List::cons(f27(f5(List::cons(v4, List::cons(Str::lit(".rs"), List::<Str>::nil()))), {
        let m64 = match v3.clone() {
            Adt9::C0(_, _, _, _, _, _, _, h63) => {
                h63
            }
        };
        match m64 {
            Adt10::C0 => {
                f31(v1, v3)?
            }
            Adt10::C1(v5) => {
                f32(v1, v3, v5)?
            }
        }
    }), List::<Adt3>::nil())))))
}

pub fn f12(p91: List<Bytes>, p92: u64, p93: Option<Str>, p94: Option<Str>, p95: bool, p96: List<Str>, p97: List<Adt15>) -> R<Adt14> {
    let m90 = (p91, (p92, (p93, (p94, (p95, (p96, p97))))));
    {
        let mut m90 = m90;
        loop {
            let step = {
                let (v0, (v1, (v2, (v3, (v4, (v5, v6)))))) = m90;
                let m65 = v0;
                match m65.uncons() {
                    None => {
                        let m66 = v2;
                        match m66 {
                            None => {
                                Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(Adt14::C1(0u64, Bytes::lit(&[]), Str::lit("the WIT text has no complete package and world"))))
                            }
                            Some(v7) => {
                                let m67 = v3;
                                match m67 {
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
                        let v11: Bytes = f33(v9)?;
                        if f34(v11.clone(), Bytes::lit(&[0x2f, 0x2f, 0x2f])) {
                            Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                let a68 = v1;
                                let a69 = 1u64;
                                nat_add(a68, a69)?
                            }, (v2, (v3, (v4, ({
                                let a70 = v5;
                                let a71 = List::cons(f16(f33(f35(v11, 3u64, 0u64)?)?), List::<Str>::nil());
                                append_list(a70, a71)
                            }, v6)))))))
                        } else {
                            let a72 = f3(v11.clone());
                            let a73 = 0u64;
                            if if nat_eq(a72, a73) {
                                true
                            } else {
                                f34(v11.clone(), Bytes::lit(&[0x2f, 0x2f]))
                            } {
                                Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                    let a74 = v1;
                                    let a75 = 1u64;
                                    nat_add(a74, a75)?
                                }, (v2, (v3, (v4, (List::<Str>::nil(), v6)))))))
                            } else {
                                if v4 {
                                    Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f36(v1, Str::lit("nothing may follow the world"))))
                                } else {
                                    let a76 = f37(v2.clone());
                                    if if bool_not(a76) {
                                        let a77 = f37(v3.clone());
                                        if bool_not(a77) {
                                            if f34(v11.clone(), Bytes::lit(&[0x70, 0x61, 0x63, 0x6b, 0x61, 0x67, 0x65, 0x20])) {
                                                if f38(v11.clone(), Bytes::lit(&[0x3b]))? {
                                                    f39(f35(v11.clone(), 8u64, 1u64)?)?
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
                                            let a78 = v1;
                                            let a79 = 1u64;
                                            nat_add(a78, a79)?
                                        }, (Some(f16(f35(v11, 8u64, 1u64)?)), (v3, (v4, (List::<Str>::nil(), v6)))))))
                                    } else {
                                        if if f37(v2.clone()) {
                                            let a80 = f37(v3.clone());
                                            if bool_not(a80) {
                                                if f34(v11.clone(), Bytes::lit(&[0x77, 0x6f, 0x72, 0x6c, 0x64, 0x20])) {
                                                    if f38(v11.clone(), Bytes::lit(&[0x20, 0x7b]))? {
                                                        f40(f35(v11.clone(), 6u64, 2u64)?)?
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
                                                let a81 = v1;
                                                let a82 = 1u64;
                                                nat_add(a81, a82)?
                                            }, (v2, (Some(f16(f35(v11, 6u64, 2u64)?)), (v4, (List::<Str>::nil(), v6)))))))
                                        } else {
                                            if if f37(v3.clone()) {
                                                if f34(v11.clone(), Bytes::lit(&[0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20])) {
                                                    true
                                                } else {
                                                    f34(v11.clone(), Bytes::lit(&[0x69, 0x6d, 0x70, 0x6f, 0x72, 0x74, 0x20]))
                                                }
                                            } else {
                                                false
                                            } {
                                                let m83 = f41(v11.clone(), v5)?;
                                                match m83 {
                                                    Adt16::C0(v12) => {
                                                        Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                                            let a84 = v1;
                                                            let a85 = 1u64;
                                                            nat_add(a84, a85)?
                                                        }, (v2, (v3, (v4, (List::<Str>::nil(), {
                                                            let a86 = v6;
                                                            let a87 = List::cons(v12, List::<Adt15>::nil());
                                                            append_list(a86, a87)
                                                        })))))))
                                                    }
                                                    Adt16::C1 => {
                                                        Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f42(v1, v11)))
                                                    }
                                                    Adt16::C2(v13) => {
                                                        Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f36(v1, v13)))
                                                    }
                                                }
                                            } else {
                                                if if f37(v3.clone()) {
                                                    f43(v11.clone(), Bytes::lit(&[0x7d]))
                                                } else {
                                                    false
                                                } {
                                                    Ok::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>((v10, ({
                                                        let a88 = v1;
                                                        let a89 = 1u64;
                                                        nat_add(a88, a89)?
                                                    }, (v2, (v3, (true, (List::<Str>::nil(), v6)))))))
                                                } else {
                                                    Err::<(List<Bytes>, (u64, (Option<Str>, (Option<Str>, (bool, (List<Str>, List<Adt15>)))))), R<Adt14>>(Ok(f42(v1, v11)))
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
                Ok(next) => { m90 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f13(v0: Bytes, v1: Bytes) -> R<List<Bytes>> {
    f44(v0.clone(), v1, 0u64, Bytes::lit(&[]), f3(v0))
}

pub fn f14(v0: u64) -> R<Str> {
    Ok(f45(v0, {
        let a98 = v0;
        let a99 = 1u64;
        nat_add(a98, a99)?
    }))
}

pub fn f15(v0: Str) -> R<Str> {
    f46(v0, Bytes::lit(&[0x22]))
}

pub fn f16(v0: Bytes) -> Str {
    f47(v0, Str::lit(""))
}

pub fn f17(v0: Adt0, v1: Str, v2: Str, v3: List<Adt7>, v4: List<Adt7>) -> R<Adt4> {
    let v5: Str = match v0.clone() {
        Adt0::C0(_, _, _, _, h100, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h100
        }
    };
    let v6: Str = match v0.clone() {
        Adt0::C0(_, h101, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h101
        }
    };
    if if f48(f49(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, h102, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h102
        }
    }, f50(v3.clone())))? {
        let a104 = f51(f49(f50(v3.clone()), match v0.clone() {
            Adt0::C0(_, _, _, _, _, _, _, h103, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h103
            }
        }))?;
        let a105 = 0u64;
        nat_eq(a104, a105)
    } else {
        false
    } {
        let a107 = f52(v4.clone())?;
        let a108 = f51(match v0.clone() {
            Adt0::C0(_, _, _, _, _, _, _, _, h106, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h106
            }
        })?;
        if nat_eq(a107, a108) {
            let v7: Adt6 = Adt6::C0(v6, v1, v2, v5, match v0.clone() {
                Adt0::C0(_, _, _, _, _, h109, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h109
                }
            }, match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, h110, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h110
                }
            }, Str::lit("memory"), v4, v3);
            let m112 = match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, h111, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h111
                }
            };
            match m112 {
                None => {
                    let m114 = match v0.clone() {
                        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h113, _, _, _, _, _, _, _, _, _, _, _, _) => {
                            h113
                        }
                    };
                    match m114 {
                        None => {
                            Ok(f4(Str::lit("generate.model"), Str::lit("the application has no name")))
                        }
                        Some(v9) => {
                            f53(v0, v7, v9)
                        }
                    }
                }
                Some(v8) => {
                    f53(v0, v7, v8)
                }
            }
        } else {
            Ok(f4(Str::lit("generate.world"), f5(List::cons(Str::lit("the imports of "), List::cons(v5, List::cons(Str::lit(" do not match "), List::cons(v6, List::<Str>::nil())))))))
        }
    } else {
        Ok(f4(Str::lit("generate.world"), f5(List::cons(Str::lit("the exports of "), List::cons(v5, List::cons(Str::lit(" do not match "), List::cons(v6, List::cons(Str::lit(": "), List::cons({
            let a116 = match v0 {
                Adt0::C0(_, _, _, _, _, _, _, h115, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                    h115
                }
            };
            let a117 = Str::lit(", ");
            join(a116, a117)
        }, List::<Str>::nil())))))))))
    }
}

pub fn f18(v0: List<Adt15>, v1: bool) -> List<Adt7> {
    let m118 = v0;
    match m118.uncons() {
        None => {
            List::<Adt7>::nil()
        }
        Some((v2, v3)) => {
            if if v1 {
                match v2.clone() {
                    Adt15::C0(h119, _) => {
                        h119
                    }
                }
            } else {
                let a121 = match v2.clone() {
                    Adt15::C0(h120, _) => {
                        h120
                    }
                };
                bool_not(a121)
            } {
                List::cons(match v2 {
                    Adt15::C0(_, h122) => {
                        h122
                    }
                }, f18(v3, v1))
            } else {
                f18(v3, v1)
            }
        }
    }
}

pub fn f19(v0: Option<(Str, Str)>, v1: Option<(Str, Str)>) -> Option<(Str, Str)> {
    let m123 = v0.clone();
    match m123 {
        None => {
            v1
        }
        Some(_) => {
            v0
        }
    }
}

pub fn f20(v0: Str, v1: Str) -> R<Option<(Str, Str)>> {
    if f54(v1.clone())? {
        Ok(None::<(Str, Str)>)
    } else {
        Ok(Some((Str::lit("generate.model"), f5(List::cons(f15(v1)?, List::cons(Str::lit(" is not a name the "), List::cons(v0, List::cons(Str::lit(" writer can bind"), List::<Str>::nil()))))))))
    }
}

pub fn f21(v0: Str) -> R<Str> {
    Ok(f47(f55({
        let a124 = v0.clone();
        utf8_encode(a124)
    }, 0u64, false, {
        let a126 = {
            let a125 = v0.clone();
            utf8_encode(a125)
        };
        length_bytes(a126)
    })?, v0))
}

pub fn f22(v0: Str) -> R<Str> {
    Ok(f56(f21(v0)?))
}

pub fn f23(v0: Adt9) -> R<Option<(Str, Str)>> {
    let m128 = match v0.clone() {
        Adt9::C0(_, _, _, _, _, _, _, h127) => {
            h127
        }
    };
    match m128 {
        Adt10::C0 => {
            Ok(None::<(Str, Str)>)
        }
        Adt10::C1(v1) => {
            Ok(f19(f57(Str::lit("rust"), match v1.clone() {
                Adt11::C0(_, _, _, _, h129, _) => {
                    h129
                }
            })?, f19(f20(Str::lit("rust"), f21(match v1.clone() {
                Adt11::C0(_, h130, _, _, _, _) => {
                    h130
                }
            })?)?, f19(f58(f22(match v1.clone() {
                Adt11::C0(_, h131, _, _, _, _) => {
                    h131
                }
            })?, match v1.clone() {
                Adt11::C0(_, _, _, _, h132, _) => {
                    h132
                }
            })?, f59(v0, v1)))))
        }
    }
}

pub fn f24(v0: Str, v1: Adt6) -> Option<(Str, Str)> {
    let a136 = {
        let a134 = match v1.clone() {
            Adt6::C0(h133, _, _, _, _, _, _, _, _) => {
                h133
            }
        };
        let a135 = Str::lit("hologram:guest/core-wasm@1");
        equal(a134, a135)
    };
    if bool_not(a136) {
        Some((Str::lit("generate.world"), f5(List::cons(Str::lit("the "), List::cons(v0, List::cons(Str::lit(" writer has no host protocol for "), List::cons(match v1 {
            Adt6::C0(h137, _, _, _, _, _, _, _, _) => {
                h137
            }
        }, List::<Str>::nil())))))))
    } else {
        let m139 = match v1.clone() {
            Adt6::C0(_, _, _, _, _, _, _, h138, _) => {
                h138
            }
        };
        match m139.uncons() {
            None => {
                None::<(Str, Str)>
            }
            Some((_, _)) => {
                Some((Str::lit("generate.world"), f5(List::cons(Str::lit("the "), List::cons(v0, List::cons(Str::lit(" writer binds import-free worlds; "), List::cons(match v1 {
                    Adt6::C0(h140, _, _, _, _, _, _, _, _) => {
                        h140
                    }
                }, List::cons(Str::lit(" has imports"), List::<Str>::nil()))))))))
            }
        }
    }
}

pub fn f25(v0: Str, v1: bool, v2: List<(Str, Str)>, v3: List<Adt7>) -> R<Option<(Str, Str)>> {
    let m141 = v3;
    match m141.uncons() {
        None => {
            Ok(None::<(Str, Str)>)
        }
        Some((v4, v5)) => {
            Ok(f19(if v1 {
                f20(v0.clone(), match v4.clone() {
                    Adt7::C0(h142, _, _, _) => {
                        h142
                    }
                })?
            } else {
                None::<(Str, Str)>
            }, f19(f60(v0.clone(), v1, v2.clone(), match v4.clone() {
                Adt7::C0(_, h143, _, _) => {
                    h143
                }
            })?, f19({
                let m145 = match v4 {
                    Adt7::C0(_, _, h144, _) => {
                        h144
                    }
                };
                match m145 {
                    None => {
                        None::<(Str, Str)>
                    }
                    Some(v6) => {
                        f61(v0.clone(), v6, v2.clone())
                    }
                }
            }, f25(v0, v1, v2, v5)?))))
        }
    }
}

pub fn f26() -> List<(Str, Str)> {
    List::cons((Str::lit("bool"), Str::lit("bool")), List::cons((Str::lit("u8"), Str::lit("u8")), List::cons((Str::lit("u16"), Str::lit("u16")), List::cons((Str::lit("u32"), Str::lit("u32")), List::cons((Str::lit("u64"), Str::lit("u64")), List::cons((Str::lit("s8"), Str::lit("i8")), List::cons((Str::lit("s16"), Str::lit("i16")), List::cons((Str::lit("s32"), Str::lit("i32")), List::cons((Str::lit("s64"), Str::lit("i64")), List::cons((Str::lit("f32"), Str::lit("f32")), List::cons((Str::lit("f64"), Str::lit("f64")), List::cons((Str::lit("char"), Str::lit("char")), List::<(Str, Str)>::nil()))))))))))))
}

pub fn f27(v0: Str, v1: Str) -> Adt3 {
    Adt3::C0(v0, v1)
}

pub fn f28(v0: Str, v1: Adt6, v2: Adt9) -> R<Str> {
    Ok(f62(List::cons(f5(List::cons(Str::lit("# Generated by `"), List::cons(v0.clone(), List::cons(Str::lit("` from "), List::cons(match v2.clone() {
        Adt9::C0(h146, _, _, _, _, _, _, _) => {
            h146
        }
    }, List::cons(Str::lit("'s model and the WIT world "), List::cons(match v1 {
        Adt6::C0(h147, _, _, _, _, _, _, _, _) => {
            h147
        }
    }, List::cons(Str::lit("."), List::<Str>::nil())))))))), List::cons(f5(List::cons(Str::lit("# Do not edit: run `"), List::cons(v0.clone(), List::cons(Str::lit("` again."), List::<Str>::nil())))), List::cons(Str::lit("[package]"), List::cons(f5(List::cons(Str::lit("name = "), List::cons(f15(f5(List::cons(match v2.clone() {
        Adt9::C0(_, _, h148, _, _, _, _, _) => {
            h148
        }
    }, List::cons(Str::lit("-client"), List::<Str>::nil()))))?, List::cons(Str::lit(""), List::<Str>::nil())))), List::cons(Str::lit("version = \"0.1.0\"\u{a}edition = \"2021\""), List::cons(f5(List::cons(Str::lit("description = "), List::cons(f15(f5(List::cons(Str::lit("A client for "), List::cons(match v2 {
        Adt9::C0(h149, _, _, _, _, _, _, _) => {
            h149
        }
    }, List::cons(Str::lit(", generated by "), List::cons(v0, List::cons(Str::lit("."), List::<Str>::nil())))))))?, List::<Str>::nil()))), List::cons(Str::lit("publish = false\u{a}\u{a}[lib]\u{a}path = \"lib.rs\"\u{a}\u{a}[dependencies]"), List::<Str>::nil())))))))))
}

pub fn f29(v0: Str, v1: Adt6, v2: Adt9, v3: Str) -> Str {
    f62({
        let a163 = List::cons(f63(Str::lit("//"), v0.clone(), f5(List::cons(match v2.clone() {
            Adt9::C0(h150, _, _, _, _, _, _, _) => {
                h150
            }
        }, List::cons(Str::lit("'s model and the WIT world "), List::cons(match v1.clone() {
            Adt6::C0(h151, _, _, _, _, _, _, _, _) => {
                h151
            }
        }, List::<Str>::nil()))))), List::cons(f5(List::cons(Str::lit("//! A client for "), List::cons(match v2.clone() {
            Adt9::C0(h152, _, _, _, _, _, _, _) => {
                h152
            }
        }, List::cons(Str::lit(", generated by "), List::cons(v0, List::cons(Str::lit("."), List::<Str>::nil())))))), List::<Str>::nil()));
        let a164 = {
            let a161 = {
                let m154 = match v2.clone() {
                    Adt9::C0(_, _, _, h153, _, _, _, _) => {
                        h153
                    }
                };
                match m154 {
                    None => {
                        List::<Str>::nil()
                    }
                    Some(v4) => {
                        List::cons(Str::lit("//!"), f64(List::cons(v4, List::<Str>::nil())))
                    }
                }
            };
            let a162 = {
                let a159 = List::cons(Str::lit("//!"), List::cons(f5(List::cons(Str::lit("//! [`world`] is the world "), List::cons(match v1 {
                    Adt6::C0(h155, _, _, _, _, _, _, _, _) => {
                        h155
                    }
                }, List::cons(Str::lit(": implement [`world::Guest`] over your WebAssembly engine,"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("//! and [`world::dispatch`] sends it a request. [`"), List::cons(v3.clone(), List::cons(Str::lit("`] is the client of "), List::cons(match v2 {
                    Adt9::C0(h156, _, _, _, _, _, _, _) => {
                        h156
                    }
                }, List::cons(Str::lit("."), List::<Str>::nil())))))), List::cons(Str::lit("\u{a}#![forbid(unsafe_code)]\u{a}"), List::<Str>::nil()))));
                let a160 = {
                    let a157 = f65(List::cons(f5(List::cons(Str::lit("pub mod "), List::cons(v3.clone(), List::cons(Str::lit(";"), List::<Str>::nil())))), List::cons(Str::lit("pub mod world;"), List::<Str>::nil())));
                    let a158 = List::cons(Str::lit(""), List::cons(f5(List::cons(Str::lit("pub use "), List::cons(v3, List::cons(Str::lit("::*;"), List::<Str>::nil())))), List::cons(Str::lit("\u{a}/// What a set of bindings was generated from: a name and both digests, as prismpm.lock records them.\u{a}#[derive(Clone, Copy, Debug, PartialEq, Eq)]\u{a}pub struct Identity {\u{a}    /// The world's contract, or the application's name.\u{a}    pub name: &'static str,\u{a}    /// The BLAKE3 digest, lowercase hex.\u{a}    pub blake3: &'static str,\u{a}    /// The SHA-256 digest, lowercase hex.\u{a}    pub sha256: &'static str,\u{a}}"), List::<Str>::nil())));
                    append_list(a157, a158)
                };
                append_list(a159, a160)
            };
            append_list(a161, a162)
        };
        append_list(a163, a164)
    })
}

pub fn f30(v0: Str, v1: Adt6) -> R<Str> {
    Ok(f62({
        let a181 = List::cons(f63(Str::lit("//"), v0, f66(v1.clone())), List::cons(f5(List::cons(Str::lit("//! The world "), List::cons(match v1.clone() {
            Adt6::C0(h165, _, _, _, _, _, _, _, _) => {
                h165
            }
        }, List::cons(Str::lit(": its identity, its exports, and how a host sends it a request."), List::<Str>::nil())))), List::cons(Str::lit("\u{a}use core::fmt;\u{a}\u{a}pub use crate::Identity;\u{a}\u{a}/// The world these bindings were generated from. It equals `inputs.world` in prismpm.lock.\u{a}pub const WORLD: Identity = Identity {"), List::cons(f5(List::cons(Str::lit("    name: "), List::cons(f15(match v1.clone() {
            Adt6::C0(h166, _, _, _, _, _, _, _, _) => {
                h166
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    blake3: "), List::cons(f15(match v1.clone() {
            Adt6::C0(_, _, _, _, h167, _, _, _, _) => {
                h167
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    sha256: "), List::cons(f15(match v1.clone() {
            Adt6::C0(_, _, _, _, _, h168, _, _, _) => {
                h168
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(Str::lit("};\u{a}\u{a}/// Every export the world requires, sorted. A guest that offers any other is not of this world."), List::cons({
            let v2: List<Str> = f65(List::cons(match v1.clone() {
                Adt6::C0(_, _, _, _, _, _, h169, _, _) => {
                    h169
                }
            }, f67(match v1.clone() {
                Adt6::C0(_, _, _, _, _, _, _, _, h170) => {
                    h170
                }
            })));
            f5(List::cons(Str::lit("pub const EXPORTS: [&str; "), List::cons(f14({
                let a171 = v2.clone();
                length_list(a171)
            })?, List::cons(Str::lit("] = ["), List::cons({
                let a172 = f68(v2)?;
                let a173 = Str::lit(", ");
                join(a172, a173)
            }, List::cons(Str::lit("];"), List::<Str>::nil()))))))
        }, List::cons(Str::lit(""), List::cons(f5(List::cons(Str::lit("/// A guest of "), List::cons(match v1.clone() {
            Adt6::C0(h174, _, _, _, _, _, _, _, _) => {
                h174
            }
        }, List::cons(Str::lit(", instantiated by the host's WebAssembly engine."), List::<Str>::nil())))), List::cons(Str::lit("///"), List::cons(f5(List::cons(Str::lit("/// The guest imports nothing. Implement this over the engine's instance: each export, and `"), List::cons(match v1.clone() {
            Adt6::C0(_, _, _, _, _, _, h175, _, _) => {
                h175
            }
        }, List::cons(Str::lit("` as a read and a write."), List::<Str>::nil())))), List::cons(Str::lit("pub trait Guest {\u{a}    /// What the engine reports when a call into the guest fails, such as a trap.\u{a}    type Error;\u{a}"), List::<Str>::nil())))))))))))));
        let a182 = {
            let a179 = f69(match v1.clone() {
                Adt6::C0(_, _, _, _, _, _, _, _, h176) => {
                    h176
                }
            })?;
            let a180 = List::cons(f5(List::cons(Str::lit("    /// Copy `bytes` into the guest's `"), List::cons(match v1.clone() {
                Adt6::C0(_, _, _, _, _, _, h177, _, _) => {
                    h177
                }
            }, List::cons(Str::lit("` at `offset`."), List::<Str>::nil())))), List::cons(Str::lit("    fn write_memory(&mut self, offset: u32, bytes: &[u8]) -> Result<(), Self::Error>;\u{a}"), List::cons(f5(List::cons(Str::lit("    /// Copy `length` bytes out of the guest's `"), List::cons(match v1 {
                Adt6::C0(_, _, _, _, _, _, h178, _, _) => {
                    h178
                }
            }, List::cons(Str::lit("` at `offset`. Fails when they are outside it."), List::<Str>::nil())))), List::cons(Str::lit("    fn read_memory(&mut self, offset: u32, length: u32) -> Result<Vec<u8>, Self::Error>;\u{a}}\u{a}"), List::cons(f70(), List::<Str>::nil())))));
            append_list(a179, a180)
        };
        append_list(a181, a182)
    }))
}

pub fn f31(v0: Str, v1: Adt9) -> R<Str> {
    let v2: Str = match v1.clone() {
        Adt9::C0(h183, _, _, _, _, _, _, _) => {
            h183
        }
    };
    Ok(f62({
        let a192 = List::cons(f63(Str::lit("//"), v0, f71(v1.clone())), List::cons(f5(List::cons(Str::lit("//! The client of "), List::cons(v2.clone(), List::cons(Str::lit(", over request and response bytes."), List::<Str>::nil())))), List::cons(Str::lit("\u{a}pub use crate::Identity;\u{a}\u{a}/// The model this client was generated from. It equals `inputs.model` in prismpm.lock.\u{a}pub const MODEL: Identity = Identity {"), List::cons(f5(List::cons(Str::lit("    name: "), List::cons(f15(match v1.clone() {
            Adt9::C0(h184, _, _, _, _, _, _, _) => {
                h184
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    blake3: "), List::cons(f15(match v1.clone() {
            Adt9::C0(_, _, _, _, _, h185, _, _) => {
                h185
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    sha256: "), List::cons(f15(match v1.clone() {
            Adt9::C0(_, _, _, _, _, _, h186, _) => {
                h186
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(Str::lit("};\u{a}"), List::<Str>::nil())))))));
        let a193 = {
            let a190 = f72(Str::lit(""), f73(v1.clone(), f5(List::cons(Str::lit("A client for "), List::cons(v2.clone(), List::cons(Str::lit(", over request and response bytes."), List::<Str>::nil()))))));
            let a191 = List::cons(Str::lit("///"), List::cons(f5(List::cons(Str::lit("/// "), List::cons(v2, List::cons(Str::lit("'s model describes no typed operations, so the client sends bytes."), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("pub struct "), List::cons(match v1.clone() {
                Adt9::C0(_, h187, _, _, _, _, _, _) => {
                    h187
                }
            }, List::cons(Str::lit("<D> {"), List::<Str>::nil())))), List::cons(Str::lit("    dispatch: D,\u{a}}\u{a}"), List::cons(f5(List::cons(Str::lit("impl<D, E> "), List::cons(match v1.clone() {
                Adt9::C0(_, h188, _, _, _, _, _, _) => {
                    h188
                }
            }, List::cons(Str::lit("<D>"), List::<Str>::nil())))), List::cons(Str::lit("where\u{a}    D: FnMut(&[u8]) -> Result<Vec<u8>, E>,\u{a}{\u{a}    /// A client over this dispatch function.\u{a}    pub fn new(dispatch: D) -> Self {"), List::cons(f5(List::cons(Str::lit("        "), List::cons(match v1 {
                Adt9::C0(_, h189, _, _, _, _, _, _) => {
                    h189
                }
            }, List::cons(Str::lit(" { dispatch }"), List::<Str>::nil())))), List::cons(Str::lit("    }\u{a}\u{a}    /// Send one request and return the response bytes.\u{a}    pub fn invoke(&mut self, request: &[u8]) -> Result<Vec<u8>, E> {\u{a}        (self.dispatch)(request)\u{a}    }\u{a}}"), List::<Str>::nil()))))))));
            append_list(a190, a191)
        };
        append_list(a192, a193)
    }))
}

pub fn f32(v0: Str, v1: Adt9, v2: Adt11) -> R<Str> {
    let v3: Str = match v1.clone() {
        Adt9::C0(h194, _, _, _, _, _, _, _) => {
            h194
        }
    };
    let v4: Str = match v2.clone() {
        Adt11::C0(h195, _, _, _, _, _) => {
            h195
        }
    };
    let v5: Str = match v2.clone() {
        Adt11::C0(_, _, _, h196, _, _) => {
            h196
        }
    };
    let v6: Str = f5(List::cons(v5.clone(), List::cons(Str::lit("Code"), List::<Str>::nil())));
    let v7: Str = match v2.clone() {
        Adt11::C0(_, _, h197, _, _, _) => {
            h197
        }
    };
    let v8: Str = f22(match v2.clone() {
        Adt11::C0(_, h198, _, _, _, _) => {
            h198
        }
    })?;
    let v9: Str = f5(List::cons(Str::lit("Result<i64, "), List::cons(v5.clone(), List::cons(Str::lit("<E>>"), List::<Str>::nil()))));
    Ok(f62({
        let a259 = List::cons(f63(Str::lit("//"), v0, f71(v1.clone())), List::cons(f5(List::cons(Str::lit("//! The client of "), List::cons(v3.clone(), List::cons(Str::lit(": one method per operation, over any dispatch function."), List::<Str>::nil())))), List::cons(Str::lit("\u{a}use core::fmt;\u{a}\u{a}pub use crate::Identity;\u{a}\u{a}/// The model this client was generated from. It equals `inputs.model` in prismpm.lock.\u{a}pub const MODEL: Identity = Identity {"), List::cons(f5(List::cons(Str::lit("    name: "), List::cons(f15(match v1.clone() {
            Adt9::C0(h199, _, _, _, _, _, _, _) => {
                h199
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    blake3: "), List::cons(f15(match v1.clone() {
            Adt9::C0(_, _, _, _, _, h200, _, _) => {
                h200
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    sha256: "), List::cons(f15(match v1.clone() {
            Adt9::C0(_, _, _, _, _, _, h201, _) => {
                h201
            }
        })?, List::cons(Str::lit(","), List::<Str>::nil())))), List::cons(Str::lit("};\u{a}"), List::cons(f5(List::cons(Str::lit("const APPLICATION: &str = "), List::cons(f15(v3.clone())?, List::cons(Str::lit(";"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("const VERSION: &str = "), List::cons(f15(v4.clone())?, List::cons(Str::lit(";"), List::<Str>::nil())))), List::cons(Str::lit(""), List::cons(f5(List::cons(Str::lit("/// An operation "), List::cons(v3.clone(), List::cons(Str::lit(" accepts."), List::<Str>::nil())))), List::cons(Str::lit("#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]"), List::cons(f5(List::cons(Str::lit("pub enum "), List::cons(v7.clone(), List::cons(Str::lit(" {"), List::<Str>::nil())))), List::<Str>::nil())))))))))))));
        let a260 = {
            let a257 = f74(match v2.clone() {
                Adt11::C0(_, _, _, _, h202, _) => {
                    h202
                }
            })?;
            let a258 = {
                let a255 = List::cons(Str::lit("}\u{a}"), List::cons(f5(List::cons(Str::lit("impl "), List::cons(v7.clone(), List::cons(Str::lit(" {"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    /// Every operation "), List::cons(v3.clone(), List::cons(Str::lit(" accepts."), List::<Str>::nil())))), List::<Str>::nil())));
                let a256 = {
                    let a253 = f75(Str::lit("    "), f5(List::cons(Str::lit("pub const ALL: [Self; "), List::cons(f14({
                        let a204 = match v2.clone() {
                            Adt11::C0(_, _, _, _, h203, _) => {
                                h203
                            }
                        };
                        length_list(a204)
                    })?, List::cons(Str::lit("]"), List::<Str>::nil())))), f76(match v2.clone() {
                        Adt11::C0(_, _, _, _, h205, _) => {
                            h205
                        }
                    })?);
                    let a254 = {
                        let a251 = List::cons(Str::lit("\u{a}    /// The name the guest reads in a request.\u{a}    pub const fn name(self) -> &'static str {\u{a}        match self {"), List::<Str>::nil());
                        let a252 = {
                            let a249 = f77(match v2.clone() {
                                Adt11::C0(_, _, _, _, h206, _) => {
                                    h206
                                }
                            })?;
                            let a250 = {
                                let a247 = List::cons(Str::lit("        }\u{a}    }\u{a}}\u{a}"), List::cons(f5(List::cons(Str::lit("/// An answer with which "), List::cons(v3.clone(), List::cons(Str::lit(" refuses a request."), List::<Str>::nil())))), List::cons(Str::lit("#[derive(Clone, Debug, PartialEq, Eq, Hash)]"), List::cons(f5(List::cons(Str::lit("pub enum "), List::cons(v6.clone(), List::cons(Str::lit(" {"), List::<Str>::nil())))), List::<Str>::nil()))));
                                let a248 = {
                                    let a245 = f78(v1.clone(), v4.clone(), match v2.clone() {
                                        Adt11::C0(_, _, _, _, _, h207) => {
                                            h207
                                        }
                                    })?;
                                    let a246 = {
                                        let a243 = List::cons(Str::lit("    /// An answer this client was not generated with.\u{a}    Other(String),\u{a}}\u{a}"), List::cons(f5(List::cons(Str::lit("impl "), List::cons(v6.clone(), List::cons(Str::lit(" {"), List::<Str>::nil())))), List::cons(Str::lit("    /// The code as the guest wrote it.\u{a}    pub fn code(&self) -> &str {\u{a}        match self {"), List::<Str>::nil())));
                                        let a244 = {
                                            let a241 = f79(match v2.clone() {
                                                Adt11::C0(_, _, _, _, _, h208) => {
                                                    h208
                                                }
                                            })?;
                                            let a242 = {
                                                let a239 = List::cons(Str::lit("            Self::Other(code) => code,\u{a}        }\u{a}    }\u{a}\u{a}    /// What the model says this answer means, for a person.\u{a}    pub fn message(&self) -> &str {\u{a}        match self {"), List::<Str>::nil());
                                                let a240 = {
                                                    let a237 = f80(v1.clone(), v4, match v2.clone() {
                                                        Adt11::C0(_, _, _, _, _, h209) => {
                                                            h209
                                                        }
                                                    })?;
                                                    let a238 = {
                                                        let a235 = f81(Str::lit("            "), Str::lit("Self::Other(_)"), f15(f5(List::cons(v3.clone(), List::cons(Str::lit(" refused the request."), List::<Str>::nil()))))?);
                                                        let a236 = {
                                                            let a233 = List::cons(Str::lit("        }\u{a}    }\u{a}\u{a}    fn from_code(code: &str) -> Self {\u{a}        match code {"), List::<Str>::nil());
                                                            let a234 = {
                                                                let a231 = f82(match v2.clone() {
                                                                    Adt11::C0(_, _, _, _, _, h210) => {
                                                                        h210
                                                                    }
                                                                })?;
                                                                let a232 = {
                                                                    let a229 = List::cons(Str::lit("            other => Self::Other(other.to_string()),\u{a}        }\u{a}    }\u{a}}\u{a}"), List::cons(f5(List::cons(Str::lit("/// Why a call to "), List::cons(v3.clone(), List::cons(Str::lit(" gave no result."), List::<Str>::nil())))), List::cons(Str::lit("#[derive(Debug)]"), List::cons(f5(List::cons(Str::lit("pub enum "), List::cons(v5.clone(), List::cons(Str::lit("<E> {"), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    /// "), List::cons(v3.clone(), List::cons(Str::lit(" refused the request, for example on overflow."), List::<Str>::nil())))), List::cons(f5(List::cons(Str::lit("    Refused("), List::cons(v6.clone(), List::cons(Str::lit("),"), List::<Str>::nil())))), List::cons(Str::lit("    /// The dispatch function failed before an answer came back.\u{a}    Dispatch(E),\u{a}    /// The answer is not one this client can read.\u{a}    Response(String),\u{a}}\u{a}"), List::cons(f5(List::cons(Str::lit("impl<E: fmt::Display> fmt::Display for "), List::cons(v5.clone(), List::cons(Str::lit("<E> {"), List::<Str>::nil())))), List::cons(Str::lit("    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {\u{a}        match self {\u{a}            Self::Refused(code) => write!(f, \"{} ({})\", code.message(), code.code()),\u{a}            Self::Dispatch(error) => write!(f, \"the request did not reach {APPLICATION}: {error}\"),\u{a}            Self::Response(why) => write!(f, \"{APPLICATION} sent an unreadable answer: {why}\"),\u{a}        }\u{a}    }\u{a}}\u{a}"), List::cons(f5(List::cons(Str::lit("impl<E: fmt::Debug + fmt::Display> std::error::Error for "), List::cons(v5.clone(), List::cons(Str::lit("<E> {}"), List::<Str>::nil())))), List::cons(Str::lit(""), List::<Str>::nil())))))))))));
                                                                    let a230 = {
                                                                        let a227 = f72(Str::lit(""), f73(v1.clone(), f5(List::cons(Str::lit("A client for "), List::cons(v3.clone(), List::cons(Str::lit("."), List::<Str>::nil()))))));
                                                                        let a228 = {
                                                                            let a225 = List::cons(Str::lit("///\u{a}/// `dispatch` sends request bytes to the guest and returns its response bytes, for\u{a}/// example `|request| crate::world::dispatch(&mut fresh_instance(), request)`."), List::cons(f5(List::cons(Str::lit("pub struct "), List::cons(match v1.clone() {
                                                                                Adt9::C0(_, h211, _, _, _, _, _, _) => {
                                                                                    h211
                                                                                }
                                                                            }, List::cons(Str::lit("<D> {"), List::<Str>::nil())))), List::cons(Str::lit("    dispatch: D,\u{a}}\u{a}"), List::cons(f5(List::cons(Str::lit("impl<D, E> "), List::cons(match v1.clone() {
                                                                                Adt9::C0(_, h212, _, _, _, _, _, _) => {
                                                                                    h212
                                                                                }
                                                                            }, List::cons(Str::lit("<D>"), List::<Str>::nil())))), List::cons(Str::lit("where\u{a}    D: FnMut(&[u8]) -> Result<Vec<u8>, E>,\u{a}{\u{a}    /// A client over this dispatch function.\u{a}    pub fn new(dispatch: D) -> Self {"), List::cons(f5(List::cons(Str::lit("        "), List::cons(match v1 {
                                                                                Adt9::C0(_, h213, _, _, _, _, _, _) => {
                                                                                    h213
                                                                                }
                                                                            }, List::cons(Str::lit(" { dispatch }"), List::<Str>::nil())))), List::cons(Str::lit("    }"), List::<Str>::nil())))))));
                                                                            let a226 = {
                                                                                let a223 = f83(v8.clone(), v7.clone(), v9.clone(), match v2 {
                                                                                    Adt11::C0(_, _, _, _, h214, _) => {
                                                                                        h214
                                                                                    }
                                                                                })?;
                                                                                let a224 = {
                                                                                    let a221 = List::cons(Str::lit("\u{a}    /// Apply `operation` to two signed 64-bit integers.\u{a}    ///"), List::cons(f5(List::cons(Str::lit("    /// A refusal by "), List::cons(v3, List::cons(Str::lit(" is `"), List::cons(v5.clone(), List::cons(Str::lit("::Refused`."), List::<Str>::nil())))))), List::<Str>::nil()));
                                                                                    let a222 = {
                                                                                        let a219 = f84(Str::lit("    "), f5(List::cons(Str::lit("pub fn "), List::cons(v8, List::<Str>::nil()))), List::cons(Str::lit("&mut self"), List::cons(f5(List::cons(Str::lit("operation: "), List::cons(v7, List::<Str>::nil()))), List::cons(Str::lit("left: i64"), List::cons(Str::lit("right: i64"), List::<Str>::nil())))), v9.clone());
                                                                                        let a220 = {
                                                                                            let a217 = List::cons(Str::lit("        let request = format!(\"{VERSION}\\t{}\\t{left}\\t{right}\", operation.name());"), List::cons(f5(List::cons(Str::lit("        let response = (self.dispatch)(request.as_bytes()).map_err("), List::cons(v5.clone(), List::cons(Str::lit("::Dispatch)?;"), List::<Str>::nil())))), List::cons(Str::lit("        read(&response)\u{a}    }\u{a}}\u{a}\u{a}/// Read a response: the request version, then `ok` and a value or `error` and a code."), List::<Str>::nil())));
                                                                                            let a218 = {
                                                                                                let a215 = f84(Str::lit(""), Str::lit("fn read<E>"), List::cons(Str::lit("response: &[u8]"), List::<Str>::nil()), v9);
                                                                                                let a216 = List::cons(if f85(v6.clone(), v5.clone()) {
                                                                                                    f5(List::cons(Str::lit("    use "), List::cons(v6, List::cons(Str::lit(" as Code;\u{a}    use "), List::cons(v5, List::cons(Str::lit("::{Refused, Response};"), List::<Str>::nil()))))))
                                                                                                } else {
                                                                                                    f5(List::cons(Str::lit("    use "), List::cons(v5, List::cons(Str::lit("::{Refused, Response};\u{a}    use "), List::cons(v6, List::cons(Str::lit(" as Code;"), List::<Str>::nil()))))))
                                                                                                }, List::cons(Str::lit("    let Ok(text) = core::str::from_utf8(response) else {\u{a}        return Err(Response(\"it is not UTF-8\".to_string()));\u{a}    };\u{a}    let mut fields = text.split('\\t');\u{a}    let (version, status, value) = (fields.next(), fields.next(), fields.next());\u{a}    if fields.next().is_some() {\u{a}        return Err(Response(format!(\"{text:?} has more than three fields\")));\u{a}    }\u{a}    if version != Some(VERSION) {\u{a}        return Err(Refused(Code::UnsupportedVersion));\u{a}    }\u{a}    match (status, value) {\u{a}        (Some(\"ok\"), Some(value)) => value\u{a}            .parse()\u{a}            .map_err(|_| Response(format!(\"{value:?} is not a signed 64-bit integer\"))),\u{a}        (Some(\"error\"), Some(code)) => Err(Refused(Code::from_code(code))),\u{a}        _ => Err(Response(format!(\"{text:?} is neither ok nor error\"))),\u{a}    }\u{a}}"), List::<Str>::nil()));
                                                                                                append_list(a215, a216)
                                                                                            };
                                                                                            append_list(a217, a218)
                                                                                        };
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
                                                };
                                                append_list(a239, a240)
                                            };
                                            append_list(a241, a242)
                                        };
                                        append_list(a243, a244)
                                    };
                                    append_list(a245, a246)
                                };
                                append_list(a247, a248)
                            };
                            append_list(a249, a250)
                        };
                        append_list(a251, a252)
                    };
                    append_list(a253, a254)
                };
                append_list(a255, a256)
            };
            append_list(a257, a258)
        };
        append_list(a259, a260)
    }))
}

pub fn f33(v0: Bytes) -> R<Bytes> {
    let v1: u64 = f86(v0.clone(), 0u64, f3(v0.clone()))?;
    let v2: u64 = f87(v0.clone(), 0u64, f3(v0.clone()), 0u64)?;
    let a261 = v2;
    let a262 = v1;
    if nat_le(a261, a262) {
        Ok(Bytes::lit(&[]))
    } else {
        Ok(f88(v0, v1, f89(v2, v1)?))
    }
}

pub fn f34(v0: Bytes, v1: Bytes) -> bool {
    f43(f88(v0, 0u64, f3(v1.clone())), v1)
}

pub fn f35(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let a265 = {
        let a263 = v1;
        let a264 = v2;
        nat_add(a263, a264)?
    };
    let a266 = f3(v0.clone());
    if nat_le(a265, a266) {
        Ok(f88(v0.clone(), v1, f89(f3(v0), {
            let a267 = v1;
            let a268 = v2;
            nat_add(a267, a268)?
        })?))
    } else {
        Ok(Bytes::lit(&[]))
    }
}

pub fn f36(v0: u64, v1: Str) -> Adt14 {
    Adt14::C1(v0, Bytes::lit(&[]), v1)
}

pub fn f37(v0: Option<Str>) -> bool {
    let m269 = v0;
    match m269 {
        None => {
            false
        }
        Some(_) => {
            true
        }
    }
}

pub fn f38(v0: Bytes, v1: Bytes) -> R<bool> {
    let a270 = f3(v1.clone());
    let a271 = f3(v0.clone());
    if nat_le(a270, a271) {
        Ok(f43(f88(v0.clone(), f89(f3(v0), f3(v1.clone()))?, f3(v1.clone())), v1))
    } else {
        Ok(false)
    }
}

pub fn f39(v0: Bytes) -> R<bool> {
    let m272 = f90(v0.clone(), Bytes::lit(&[0x3a]), 0u64, f3(v0.clone()))?;
    match m272 {
        None => {
            Ok(false)
        }
        Some(v1) => {
            if f40(f88(v0.clone(), 0u64, v1))? {
                f91(f35(v0, {
                    let a273 = v1;
                    let a274 = 1u64;
                    nat_add(a273, a274)?
                }, 0u64)?)
            } else {
                Ok(false)
            }
        }
    }
}

pub fn f40(v0: Bytes) -> R<bool> {
    if f92(f88(v0.clone(), 0u64, 1u64)) {
        f93(v0.clone(), 0u64, f3(v0), false)
    } else {
        Ok(false)
    }
}

pub fn f41(v0: Bytes, v1: List<Str>) -> R<Adt16> {
    let v2: Bytes = f35(v0.clone(), 7u64, 0u64)?;
    let m275 = f90(v2.clone(), Bytes::lit(&[0x3a]), 0u64, f3(v2.clone()))?;
    match m275 {
        None => {
            Ok(Adt16::C1)
        }
        Some(v3) => {
            let v4: Bytes = f88(v2.clone(), 0u64, v3);
            let v5: Bytes = f35(v2.clone(), {
                let a276 = v3;
                let a277 = 7u64;
                nat_add(a276, a277)?
            }, 0u64)?;
            if if f43(f88(v2, v3, 7u64), Bytes::lit(&[0x3a, 0x20, 0x66, 0x75, 0x6e, 0x63, 0x28])) {
                if f40(v4.clone())? {
                    f38(v5.clone(), Bytes::lit(&[0x3b]))?
                } else {
                    false
                }
            } else {
                false
            } {
                let m278 = f90(v5.clone(), Bytes::lit(&[0x29]), 0u64, f3(v5.clone()))?;
                match m278 {
                    None => {
                        Ok(Adt16::C1)
                    }
                    Some(v6) => {
                        let v7: Bytes = f35(v5.clone(), {
                            let a279 = v6;
                            let a280 = 1u64;
                            nat_add(a279, a280)?
                        }, 0u64)?;
                        let v8: bool = if f43(v7.clone(), Bytes::lit(&[0x3b])) {
                            true
                        } else {
                            if f34(v7.clone(), Bytes::lit(&[0x20, 0x2d, 0x3e, 0x20])) {
                                f40(f35(v7.clone(), 4u64, 1u64)?)?
                            } else {
                                false
                            }
                        };
                        if v8 {
                            let v9: Option<Str> = if f43(v7.clone(), Bytes::lit(&[0x3b])) {
                                None::<Str>
                            } else {
                                Some(f16(f35(v7, 4u64, 1u64)?))
                            };
                            let m281 = v9.clone();
                            match m281 {
                                None => {
                                    let m284 = f96(f88(v5, 0u64, v6))?;
                                    match m284 {
                                        Adt17::C0(v13) => {
                                            Ok(Adt16::C0(Adt15::C0(f34(v0, Bytes::lit(&[0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20])), Adt7::C0(f97(v4)?, v13, v9, v1))))
                                        }
                                        Adt17::C1(v14) => {
                                            Ok(Adt16::C2(v14))
                                        }
                                    }
                                }
                                Some(v10) => {
                                    if f94(v10.clone(), f95()) {
                                        let m282 = f96(f88(v5, 0u64, v6))?;
                                        match m282 {
                                            Adt17::C0(v11) => {
                                                Ok(Adt16::C0(Adt15::C0(f34(v0, Bytes::lit(&[0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20])), Adt7::C0(f97(v4)?, v11, v9, v1))))
                                            }
                                            Adt17::C1(v12) => {
                                                Ok(Adt16::C2(v12))
                                            }
                                        }
                                    } else {
                                        Ok(Adt16::C2(f98({
                                            let a283 = v10;
                                            utf8_encode(a283)
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

pub fn f42(v0: u64, v1: Bytes) -> Adt14 {
    Adt14::C1(v0, v1, Str::lit(""))
}

pub fn f43(v0: Bytes, v1: Bytes) -> bool {
    let a289 = {
        let a285 = v0;
        let a286 = v1;
        compare_bytes(a285, a286)
    };
    let a290 = {
        let a287 = Bytes::lit(&[0x00]);
        let a288 = Bytes::lit(&[0x00]);
        compare_bytes(a287, a288)
    };
    equal(a289, a290)
}

pub fn f44(v0: Bytes, v1: Bytes, v2: u64, v3: Bytes, v4: u64) -> R<List<Bytes>> {
    let m291 = v4;
    if m291 == 0 {
        Ok(List::cons(v3, List::<Bytes>::nil()))
    } else {
        let v5 = m291 - 1;
        if f43(f88(v0.clone(), v2, 1u64), v1.clone()) {
            Ok(List::cons(v3, f44(v0, v1, {
                let a292 = v2;
                let a293 = 1u64;
                nat_add(a292, a293)?
            }, Bytes::lit(&[]), v5)?))
        } else {
            f44(v0.clone(), v1, {
                let a294 = v2;
                let a295 = 1u64;
                nat_add(a294, a295)?
            }, {
                let a296 = v3;
                let a297 = f88(v0, v2, 1u64);
                append_bytes(a296, a297)
            }, v5)
        }
    }
}

pub fn f45(v0: u64, v1: u64) -> Str {
    let m298 = v1;
    if m298 == 0 {
        Str::lit("")
    } else {
        let v2 = m298 - 1;
        let a299 = v0;
        let a300 = 10u64;
        if nat_lt(a299, a300) {
            f99(v0)
        } else {
            f5(List::cons(f45({
                let a301 = v0;
                let a302 = 10u64;
                let a303 = 0u64;
                nat_quot(a301, a302, a303)
            }, v2), List::cons(f99({
                let a304 = v0;
                let a305 = 10u64;
                let a306 = 0u64;
                nat_rem(a304, a305, a306)
            }), List::<Str>::nil())))
        }
    }
}

pub fn f46(v0: Str, v1: Bytes) -> R<Str> {
    Ok(f47({
        let a312 = {
            let a310 = v1.clone();
            let a311 = f100({
                let a307 = v0.clone();
                utf8_encode(a307)
            }, 0u64, v1.clone(), {
                let a309 = {
                    let a308 = v0.clone();
                    utf8_encode(a308)
                };
                length_bytes(a309)
            })?;
            append_bytes(a310, a311)
        };
        let a313 = v1;
        append_bytes(a312, a313)
    }, v0))
}

pub fn f47(v0: Bytes, v1: Str) -> Str {
    let m315 = {
        let a314 = v0;
        utf8_decode(a314)
    };
    match m315 {
        None => {
            v1
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f48(v0: List<Str>) -> R<bool> {
    let m316 = v0;
    match m316.uncons() {
        None => {
            Ok(false)
        }
        Some((v1, v2)) => {
            let a317 = v1;
            let a318 = Str::lit("memory");
            if equal(a317, a318) {
                let a319 = f51(v2)?;
                let a320 = 0u64;
                Ok(nat_eq(a319, a320))
            } else {
                Ok(false)
            }
        }
    }
}

pub fn f49(v0: List<Str>, v1: List<Str>) -> List<Str> {
    let m321 = v0;
    match m321.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v2, v3)) => {
            if f94(v2.clone(), v1.clone()) {
                f49(v3, v1)
            } else {
                List::cons(v2, f49(v3, v1))
            }
        }
    }
}

pub fn f50(v0: List<Adt7>) -> List<Str> {
    let m322 = v0;
    match m322.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(match v1 {
                Adt7::C0(h323, _, _, _) => {
                    h323
                }
            }, f50(v2))
        }
    }
}

pub fn f51(v0: List<Str>) -> R<u64> {
    let m324 = v0;
    match m324.uncons() {
        None => {
            Ok(0u64)
        }
        Some((_, v2)) => {
            let a325 = f51(v2)?;
            let a326 = 1u64;
            nat_add(a325, a326)
        }
    }
}

pub fn f52(v0: List<Adt7>) -> R<u64> {
    let m327 = v0;
    match m327.uncons() {
        None => {
            Ok(0u64)
        }
        Some((_, v2)) => {
            let a328 = f52(v2)?;
            let a329 = 1u64;
            nat_add(a328, a329)
        }
    }
}

pub fn f53(v0: Adt0, v1: Adt6, v2: Str) -> R<Adt4> {
    let v3: Str = f101(v2.clone())?;
    if f102(v3.clone())? {
        if f103(v0.clone())? {
            let m332 = f104(match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h330, _, _, _) => {
                    h330
                }
            }, List::cons(match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h331, _, _, _, _, _, _, _, _) => {
                    h331
                }
            }, List::cons(Str::lit("constructor"), List::<Str>::nil())))?;
            match m332 {
                None => {
                    let m334 = match v0.clone() {
                        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h333, _, _, _) => {
                            h333
                        }
                    };
                    match m334.uncons() {
                        None => {
                            Ok(f4(Str::lit("generate.model"), Str::lit("the model document has no operations")))
                        }
                        Some((_, _)) => {
                            f105(v0.clone(), v1, v2, v3, Adt10::C1(Adt11::C0(Str::lit("1"), match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h335, _, _, _, _, _, _, _, _) => {
                                    h335
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h336, _, _, _, _, _, _, _) => {
                                    h336
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h337, _, _, _, _, _, _) => {
                                    h337
                                }
                            }, f106(match v0.clone() {
                                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h338, _, _, _) => {
                                    h338
                                }
                            }), f107(v0))))
                        }
                    }
                }
                Some(v4) => {
                    Ok(f4(Str::lit("generate.model"), v4))
                }
            }
        } else {
            f105(v0, v1, v2, v3, Adt10::C0)
        }
    } else {
        Ok(f4(Str::lit("generate.model"), f5(List::cons(Str::lit("the application name "), List::cons(f15(v2)?, List::cons(Str::lit(" is not one generate can turn into a class name"), List::<Str>::nil()))))))
    }
}

pub fn f54(v0: Str) -> R<bool> {
    let v1: Bytes = {
        let a339 = v0;
        utf8_encode(a339)
    };
    let a343 = {
        let a341 = {
            let a340 = v1.clone();
            length_bytes(a340)
        };
        let a342 = 0u64;
        nat_eq(a341, a342)
    };
    if bool_not(a343) {
        let a344 = f108(f88(v1.clone(), 0u64, 1u64), f109(), 10u64);
        if bool_not(a344) {
            f110(v1.clone(), 0u64, {
                let a345 = v1;
                length_bytes(a345)
            })
        } else {
            Ok(false)
        }
    } else {
        Ok(false)
    }
}

pub fn f55(v0: Bytes, v1: u64, v2: bool, v3: u64) -> R<Bytes> {
    let m346 = v3;
    if m346 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v4 = m346 - 1;
        let v5: Bytes = f88(v0.clone(), v1, 1u64);
        if f43(v5.clone(), Bytes::lit(&[0x2d])) {
            let a349 = Bytes::lit(&[0x5f]);
            let a350 = f55(v0, {
                let a347 = v1;
                let a348 = 1u64;
                nat_add(a347, a348)?
            }, false, v4)?;
            Ok(append_bytes(a349, a350))
        } else {
            if f111(v5.clone()) {
                let a355 = if v2 {
                    let a351 = Bytes::lit(&[0x5f]);
                    let a352 = f112(v5);
                    append_bytes(a351, a352)
                } else {
                    f112(v5)
                };
                let a356 = f55(v0, {
                    let a353 = v1;
                    let a354 = 1u64;
                    nat_add(a353, a354)?
                }, false, v4)?;
                Ok(append_bytes(a355, a356))
            } else {
                let a359 = v5.clone();
                let a360 = f55(v0, {
                    let a357 = v1;
                    let a358 = 1u64;
                    nat_add(a357, a358)?
                }, f113(v5), v4)?;
                Ok(append_bytes(a359, a360))
            }
        }
    }
}

pub fn f56(v0: Str) -> Str {
    if f94(v0.clone(), f114()) {
        f5(List::cons(Str::lit("r#"), List::cons(v0, List::<Str>::nil())))
    } else {
        v0
    }
}

pub fn f57(v0: Str, v1: List<Adt12>) -> R<Option<(Str, Str)>> {
    let m361 = v1;
    match m361.uncons() {
        None => {
            Ok(None::<(Str, Str)>)
        }
        Some((v2, v3)) => {
            Ok(f19(f20(v0.clone(), f21(match v2 {
                Adt12::C0(h362, _, _) => {
                    h362
                }
            })?)?, f57(v0, v3)?))
        }
    }
}

pub fn f58(v0: Str, p367: List<Adt12>) -> R<Option<(Str, Str)>> {
    let m366 = p367;
    {
        let mut m366 = m366;
        loop {
            let step = {
                let v1 = m366;
                let m363 = v1;
                match m363.uncons() {
                    None => {
                        Err::<List<Adt12>, R<Option<(Str, Str)>>>(Ok(None::<(Str, Str)>))
                    }
                    Some((v2, v3)) => {
                        let v4: Str = f22(match v2.clone() {
                            Adt12::C0(h364, _, _) => {
                                h364
                            }
                        })?;
                        if f94(v4.clone(), List::cons(Str::lit("new"), List::cons(v0.clone(), List::cons(Str::lit("dispatch"), List::cons(Str::lit("read"), List::<Str>::nil()))))) {
                            Err::<List<Adt12>, R<Option<(Str, Str)>>>(Ok(f115(match v2 {
                                Adt12::C0(h365, _, _) => {
                                    h365
                                }
                            }, v4)))
                        } else {
                            Ok::<List<Adt12>, R<Option<(Str, Str)>>>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m366 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f59(v0: Adt9, v1: Adt11) -> Option<(Str, Str)> {
    if f116(Str::lit("unsupported-version"), match v1 {
        Adt11::C0(_, _, _, _, _, h368) => {
            h368
        }
    }) {
        None::<(Str, Str)>
    } else {
        Some((Str::lit("generate.model"), f5(List::cons(match v0 {
            Adt9::C0(h369, _, _, _, _, _, _, _) => {
                h369
            }
        }, List::cons(Str::lit("'s model has no unsupported-version error"), List::<Str>::nil())))))
    }
}

pub fn f60(v0: Str, v1: bool, v2: List<(Str, Str)>, v3: List<Adt8>) -> R<Option<(Str, Str)>> {
    let m370 = v3;
    match m370.uncons() {
        None => {
            Ok(None::<(Str, Str)>)
        }
        Some((v4, v5)) => {
            Ok(f19(if v1 {
                f20(v0.clone(), f21(match v4.clone() {
                    Adt8::C0(h371, _) => {
                        h371
                    }
                })?)?
            } else {
                None::<(Str, Str)>
            }, f19(f61(v0.clone(), match v4 {
                Adt8::C0(_, h372) => {
                    h372
                }
            }, v2.clone()), f60(v0, v1, v2, v5)?)))
        }
    }
}

pub fn f61(v0: Str, v1: Str, v2: List<(Str, Str)>) -> Option<(Str, Str)> {
    let m373 = f117(v1.clone(), v2);
    match m373 {
        None => {
            Some((Str::lit("generate.world"), f5(List::cons(Str::lit("the "), List::cons(v0, List::cons(Str::lit(" writer has no type for WIT "), List::cons(v1, List::<Str>::nil())))))))
        }
        Some(_) => {
            None::<(Str, Str)>
        }
    }
}

pub fn f62(v0: List<Str>) -> Str {
    let a376 = {
        let a374 = v0;
        let a375 = List::cons(Str::lit(""), List::<Str>::nil());
        append_list(a374, a375)
    };
    let a377 = Str::lit("\u{a}");
    join(a376, a377)
}

pub fn f63(v0: Str, v1: Str, v2: Str) -> Str {
    f5(List::cons(v0.clone(), List::cons(Str::lit(" Generated by `"), List::cons(v1.clone(), List::cons(Str::lit("` from "), List::cons(v2, List::cons(Str::lit(".\u{a}"), List::cons(v0, List::cons(Str::lit(" Do not edit: run `"), List::cons(v1, List::cons(Str::lit("` again.\u{a}"), List::<Str>::nil())))))))))))
}

pub fn f64(v0: List<Str>) -> List<Str> {
    let m378 = v0;
    match m378.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(f118(f5(List::cons(Str::lit("//! "), List::cons(v1, List::<Str>::nil())))), f64(v2))
        }
    }
}

pub fn f65(v0: List<Str>) -> List<Str> {
    let m379 = v0;
    match m379.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            f119(v1, f65(v2))
        }
    }
}

pub fn f66(v0: Adt6) -> Str {
    f5(List::cons(Str::lit("the WIT world "), List::cons(match v0.clone() {
        Adt6::C0(h380, _, _, _, _, _, _, _, _) => {
            h380
        }
    }, List::cons(Str::lit(" ("), List::cons(match v0 {
        Adt6::C0(_, _, _, h381, _, _, _, _, _) => {
            h381
        }
    }, List::cons(Str::lit(")"), List::<Str>::nil()))))))
}

pub fn f67(v0: List<Adt7>) -> List<Str> {
    let m382 = v0;
    match m382.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(match v1 {
                Adt7::C0(h383, _, _, _) => {
                    h383
                }
            }, f67(v2))
        }
    }
}

pub fn f68(v0: List<Str>) -> R<List<Str>> {
    let m384 = v0;
    match m384.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            Ok(List::cons(f15(v1)?, f68(v2)?))
        }
    }
}

pub fn f69(v0: List<Adt7>) -> R<List<Str>> {
    let m385 = v0;
    match m385.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            let a391 = f72(Str::lit("    "), match v1.clone() {
                Adt7::C0(_, _, _, h386) => {
                    h386
                }
            });
            let a392 = List::cons(f5(List::cons(Str::lit("    fn "), List::cons(f56(match v1.clone() {
                Adt7::C0(h387, _, _, _) => {
                    h387
                }
            }), List::cons(Str::lit("(&mut self"), List::cons(f120(match v1.clone() {
                Adt7::C0(_, h388, _, _) => {
                    h388
                }
            })?, List::cons(Str::lit(") -> Result<"), List::cons({
                let m390 = match v1 {
                    Adt7::C0(_, _, h389, _) => {
                        h389
                    }
                };
                match m390 {
                    None => {
                        Str::lit("()")
                    }
                    Some(v3) => {
                        f121(v3)
                    }
                }
            }, List::cons(Str::lit(", Self::Error>;"), List::<Str>::nil())))))))), List::cons(Str::lit(""), f69(v2)?));
            Ok(append_list(a391, a392))
        }
    }
}

pub fn f70() -> Str {
    Str::lit("/// Why a request did not come back from the guest.\u{a}#[derive(Debug)]\u{a}pub enum DispatchError<E> {\u{a}    /// The request is longer than a guest can address.\u{a}    TooLong(usize),\u{a}    /// A call into the guest failed, as the engine reported it.\u{a}    Guest(E),\u{a}}\u{a}\u{a}impl<E: fmt::Display> fmt::Display for DispatchError<E> {\u{a}    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {\u{a}        match self {\u{a}            Self::TooLong(length) => write!(f, \"a request of {length} bytes is too long\"),\u{a}            Self::Guest(error) => write!(f, \"the guest failed: {error}\"),\u{a}        }\u{a}    }\u{a}}\u{a}\u{a}impl<E: fmt::Debug + fmt::Display> std::error::Error for DispatchError<E> {}\u{a}\u{a}/// Why [`dispatch`] failed for a guest `G`.\u{a}pub type Failure<G> = DispatchError<<G as Guest>::Error>;\u{a}\u{a}/// Send one request to a fresh instance of the guest and return a copy of its response.\u{a}/// The guest allocator never frees, so give every request its own instance.\u{a}pub fn dispatch<G: Guest>(guest: &mut G, request: &[u8]) -> Result<Vec<u8>, Failure<G>> {\u{a}    let length = u32::try_from(request.len()).map_err(|_| DispatchError::TooLong(request.len()))?;\u{a}    let failed = DispatchError::Guest;\u{a}    let offset = guest.holo_alloc(length).map_err(failed)?;\u{a}    guest.write_memory(offset, request).map_err(failed)?;\u{a}    let packed = guest.holo_run(offset, length).map_err(failed)?;\u{a}    // The response location is packed as `offset << 32 | length`.\u{a}    let at = (packed >> 32) as u32;\u{a}    let size = (packed & 0xffff_ffff) as u32;\u{a}    guest.read_memory(at, size).map_err(failed)\u{a}}")
}

pub fn f71(v0: Adt9) -> Str {
    f5(List::cons(match v0.clone() {
        Adt9::C0(h393, _, _, _, _, _, _, _) => {
            h393
        }
    }, List::cons(Str::lit("'s model ("), List::cons(match v0.clone() {
        Adt9::C0(_, _, _, _, h394, _, _, _) => {
            h394
        }
    }, List::cons(Str::lit(", blake3:"), List::cons(match v0 {
        Adt9::C0(_, _, _, _, _, h395, _, _) => {
            h395
        }
    }, List::cons(Str::lit(")"), List::<Str>::nil())))))))
}

pub fn f72(v0: Str, v1: List<Str>) -> List<Str> {
    let m396 = v1;
    match m396.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v2, v3)) => {
            List::cons(f118(f5(List::cons(v0.clone(), List::cons(Str::lit("/// "), List::cons(v2, List::<Str>::nil()))))), f72(v0, v3))
        }
    }
}

pub fn f73(v0: Adt9, v1: Str) -> List<Str> {
    let m398 = match v0 {
        Adt9::C0(_, _, _, h397, _, _, _, _) => {
            h397
        }
    };
    match m398 {
        None => {
            List::cons(v1, List::<Str>::nil())
        }
        Some(v2) => {
            List::cons(v1, List::cons(Str::lit(""), List::cons(v2, List::<Str>::nil())))
        }
    }
}

pub fn f74(v0: List<Adt12>) -> R<List<Str>> {
    let m399 = v0;
    match m399.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            Ok(List::cons(f5(List::cons(Str::lit("    /// "), List::cons(match v1.clone() {
                Adt12::C0(_, h400, _) => {
                    h400
                }
            }, List::cons(Str::lit(".\u{a}    "), List::cons(f101(match v1 {
                Adt12::C0(h401, _, _) => {
                    h401
                }
            })?, List::cons(Str::lit(","), List::<Str>::nil())))))), f74(v2)?))
        }
    }
}

pub fn f75(v0: Str, v1: Str, v2: List<Str>) -> List<Str> {
    let v3: Str = {
        let a402 = v2.clone();
        let a403 = Str::lit(", ");
        join(a402, a403)
    };
    let v4: Str = f5(List::cons(v0.clone(), List::cons(v1.clone(), List::cons(Str::lit(" = ["), List::cons(v3.clone(), List::cons(Str::lit("];"), List::<Str>::nil()))))));
    if if f122(v4.clone()) {
        let a405 = {
            let a404 = v3;
            length_string(a404)
        };
        let a406 = 60u64;
        nat_le(a405, a406)
    } else {
        false
    } {
        List::cons(v4, List::<Str>::nil())
    } else {
        let a407 = List::cons(f5(List::cons(v0.clone(), List::cons(v1, List::cons(Str::lit(" = ["), List::<Str>::nil())))), f123(f5(List::cons(v0.clone(), List::cons(Str::lit("    "), List::<Str>::nil()))), v2, Str::lit(",")));
        let a408 = List::cons(f5(List::cons(v0, List::cons(Str::lit("];"), List::<Str>::nil()))), List::<Str>::nil());
        append_list(a407, a408)
    }
}

pub fn f76(v0: List<Adt12>) -> R<List<Str>> {
    let m409 = v0;
    match m409.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            Ok(List::cons(f5(List::cons(Str::lit("Self::"), List::cons(f101(match v1 {
                Adt12::C0(h410, _, _) => {
                    h410
                }
            })?, List::<Str>::nil()))), f76(v2)?))
        }
    }
}

pub fn f77(v0: List<Adt12>) -> R<List<Str>> {
    let m411 = v0;
    match m411.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            let a414 = f81(Str::lit("            "), f5(List::cons(Str::lit("Self::"), List::cons(f101(match v1.clone() {
                Adt12::C0(h412, _, _) => {
                    h412
                }
            })?, List::<Str>::nil()))), f15(match v1 {
                Adt12::C0(h413, _, _) => {
                    h413
                }
            })?);
            let a415 = f77(v2)?;
            Ok(append_list(a414, a415))
        }
    }
}

pub fn f78(v0: Adt9, v1: Str, v2: List<Adt13>) -> R<List<Str>> {
    let m416 = v2;
    match m416.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v3, v4)) => {
            Ok(List::cons(f5(List::cons(Str::lit("    /// `"), List::cons(match v3.clone() {
                Adt13::C0(h417, _) => {
                    h417
                }
            }, List::cons(Str::lit("`: "), List::cons(f124(v0.clone(), v1.clone(), v3.clone()), List::cons(Str::lit("\u{a}    "), List::cons(f101(match v3 {
                Adt13::C0(h418, _) => {
                    h418
                }
            })?, List::cons(Str::lit(","), List::<Str>::nil())))))))), f78(v0, v1, v4)?))
        }
    }
}

pub fn f79(v0: List<Adt13>) -> R<List<Str>> {
    let m419 = v0;
    match m419.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            let a422 = f81(Str::lit("            "), f5(List::cons(Str::lit("Self::"), List::cons(f101(match v1.clone() {
                Adt13::C0(h420, _) => {
                    h420
                }
            })?, List::<Str>::nil()))), f15(match v1 {
                Adt13::C0(h421, _) => {
                    h421
                }
            })?);
            let a423 = f79(v2)?;
            Ok(append_list(a422, a423))
        }
    }
}

pub fn f80(v0: Adt9, v1: Str, v2: List<Adt13>) -> R<List<Str>> {
    let m424 = v2;
    match m424.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v3, v4)) => {
            let a426 = f81(Str::lit("            "), f5(List::cons(Str::lit("Self::"), List::cons(f101(match v3.clone() {
                Adt13::C0(h425, _) => {
                    h425
                }
            })?, List::<Str>::nil()))), f15(f124(v0.clone(), v1.clone(), v3))?);
            let a427 = f80(v0, v1, v4)?;
            Ok(append_list(a426, a427))
        }
    }
}

pub fn f81(v0: Str, v1: Str, v2: Str) -> List<Str> {
    let v3: Str = f5(List::cons(v0.clone(), List::cons(v1.clone(), List::cons(Str::lit(" => "), List::cons(v2.clone(), List::cons(Str::lit(","), List::<Str>::nil()))))));
    if f122(v3.clone()) {
        List::cons(v3, List::<Str>::nil())
    } else {
        List::cons(f5(List::cons(v0.clone(), List::cons(v1, List::cons(Str::lit(" => {"), List::<Str>::nil())))), List::cons(f5(List::cons(v0.clone(), List::cons(Str::lit("    "), List::cons(v2, List::<Str>::nil())))), List::cons(f5(List::cons(v0, List::cons(Str::lit("}"), List::<Str>::nil()))), List::<Str>::nil())))
    }
}

pub fn f82(v0: List<Adt13>) -> R<List<Str>> {
    let m428 = v0;
    match m428.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            let a431 = f81(Str::lit("            "), f15(match v1.clone() {
                Adt13::C0(h429, _) => {
                    h429
                }
            })?, f5(List::cons(Str::lit("Self::"), List::cons(f101(match v1 {
                Adt13::C0(h430, _) => {
                    h430
                }
            })?, List::<Str>::nil()))));
            let a432 = f82(v2)?;
            Ok(append_list(a431, a432))
        }
    }
}

pub fn f83(v0: Str, v1: Str, v2: Str, v3: List<Adt12>) -> R<List<Str>> {
    let m433 = v3;
    match m433.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v4, v5)) => {
            let v6: Str = f101(match v4.clone() {
                Adt12::C0(h434, _, _) => {
                    h434
                }
            })?;
            let a441 = List::cons(Str::lit(""), List::cons(f5(List::cons(Str::lit("    /// "), List::cons(match v4.clone() {
                Adt12::C0(_, h435, _) => {
                    h435
                }
            }, List::cons(Str::lit(": `"), List::cons(v0.clone(), List::cons(Str::lit("("), List::cons(v1.clone(), List::cons(Str::lit("::"), List::cons(v6.clone(), List::cons(Str::lit(", left, right)`."), List::<Str>::nil())))))))))), List::<Str>::nil()));
            let a442 = {
                let a439 = f84(Str::lit("    "), f5(List::cons(Str::lit("pub fn "), List::cons(f22(match v4 {
                    Adt12::C0(h436, _, _) => {
                        h436
                    }
                })?, List::<Str>::nil()))), List::cons(Str::lit("&mut self"), List::cons(Str::lit("left: i64"), List::cons(Str::lit("right: i64"), List::<Str>::nil()))), v2.clone());
                let a440 = {
                    let a437 = List::cons(f5(List::cons(Str::lit("        self."), List::cons(v0.clone(), List::cons(Str::lit("("), List::cons(v1.clone(), List::cons(Str::lit("::"), List::cons(v6, List::cons(Str::lit(", left, right)"), List::<Str>::nil())))))))), List::cons(Str::lit("    }"), List::<Str>::nil()));
                    let a438 = f83(v0, v1, v2, v5)?;
                    append_list(a437, a438)
                };
                append_list(a439, a440)
            };
            Ok(append_list(a441, a442))
        }
    }
}

pub fn f84(v0: Str, v1: Str, v2: List<Str>, v3: Str) -> List<Str> {
    let v4: Str = f5(List::cons(v0.clone(), List::cons(v1.clone(), List::cons(Str::lit("("), List::cons({
        let a443 = v2.clone();
        let a444 = Str::lit(", ");
        join(a443, a444)
    }, List::cons(Str::lit(") -> "), List::cons(v3.clone(), List::cons(Str::lit(" {"), List::<Str>::nil()))))))));
    if f122(v4.clone()) {
        List::cons(v4, List::<Str>::nil())
    } else {
        let a445 = List::cons(f5(List::cons(v0.clone(), List::cons(v1, List::cons(Str::lit("("), List::<Str>::nil())))), f123(f5(List::cons(v0.clone(), List::cons(Str::lit("    "), List::<Str>::nil()))), v2, Str::lit(",")));
        let a446 = List::cons(f5(List::cons(v0, List::cons(Str::lit(") -> "), List::cons(v3, List::cons(Str::lit(" {"), List::<Str>::nil()))))), List::<Str>::nil());
        append_list(a445, a446)
    }
}

pub fn f85(v0: Str, v1: Str) -> bool {
    let a453 = {
        let a449 = {
            let a447 = v0;
            utf8_encode(a447)
        };
        let a450 = {
            let a448 = v1;
            utf8_encode(a448)
        };
        compare_bytes(a449, a450)
    };
    let a454 = {
        let a451 = Bytes::lit(&[0x00]);
        let a452 = Bytes::lit(&[0x01]);
        compare_bytes(a451, a452)
    };
    equal(a453, a454)
}

pub fn f86(v0: Bytes, p459: u64, p460: u64) -> R<u64> {
    let m458 = (p459, p460);
    {
        let mut m458 = m458;
        loop {
            let step = {
                let (v1, v2) = m458;
                let m455 = v2;
                if m455 == 0 {
                    Err::<(u64, u64), R<u64>>(Ok(v1))
                } else {
                    let v3 = m455 - 1;
                    if f125(f88(v0.clone(), v1, 1u64)) {
                        Ok::<(u64, u64), R<u64>>(({
                            let a456 = v1;
                            let a457 = 1u64;
                            nat_add(a456, a457)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<u64>>(Ok(v1))
                    }
                }
            };
            match step {
                Ok(next) => { m458 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f87(v0: Bytes, p467: u64, p468: u64, p469: u64) -> R<u64> {
    let m466 = (p467, (p468, p469));
    {
        let mut m466 = m466;
        loop {
            let step = {
                let (v1, (v2, v3)) = m466;
                let m461 = v2;
                if m461 == 0 {
                    Err::<(u64, (u64, u64)), R<u64>>(Ok(v3))
                } else {
                    let v4 = m461 - 1;
                    Ok::<(u64, (u64, u64)), R<u64>>(({
                        let a462 = v1;
                        let a463 = 1u64;
                        nat_add(a462, a463)?
                    }, (v4, if f125(f88(v0.clone(), v1, 1u64)) {
                        v3
                    } else {
                        let a464 = v1;
                        let a465 = 1u64;
                        nat_add(a464, a465)?
                    })))
                }
            };
            match step {
                Ok(next) => { m466 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f88(v0: Bytes, v1: u64, v2: u64) -> Bytes {
    let m473 = {
        let a470 = v0;
        let a471 = v1;
        let a472 = v2;
        slice_bytes(a470, a471, a472)
    };
    match m473 {
        None => {
            Bytes::lit(&[])
        }
        Some(v3) => {
            v3
        }
    }
}

pub fn f89(v0: u64, v1: u64) -> R<u64> {
    f126(v0, v1, 0u64, {
        let a474 = v0;
        let a475 = 1u64;
        nat_add(a474, a475)?
    })
}

pub fn f90(v0: Bytes, v1: Bytes, p480: u64, p481: u64) -> R<Option<u64>> {
    let m479 = (p480, p481);
    {
        let mut m479 = m479;
        loop {
            let step = {
                let (v2, v3) = m479;
                let m476 = v3;
                if m476 == 0 {
                    Err::<(u64, u64), R<Option<u64>>>(Ok(None::<u64>))
                } else {
                    let v4 = m476 - 1;
                    if f43(f88(v0.clone(), v2, 1u64), v1.clone()) {
                        Err::<(u64, u64), R<Option<u64>>>(Ok(Some(v2)))
                    } else {
                        Ok::<(u64, u64), R<Option<u64>>>(({
                            let a477 = v2;
                            let a478 = 1u64;
                            nat_add(a477, a478)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m479 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f91(v0: Bytes) -> R<bool> {
    let m482 = f90(v0.clone(), Bytes::lit(&[0x40]), 0u64, f3(v0.clone()))?;
    match m482 {
        None => {
            f40(v0)
        }
        Some(v1) => {
            if f40(f88(v0.clone(), 0u64, v1))? {
                let a487 = {
                    let a485 = f3(v0.clone());
                    let a486 = {
                        let a483 = v1;
                        let a484 = 1u64;
                        nat_add(a483, a484)?
                    };
                    nat_eq(a485, a486)
                };
                if bool_not(a487) {
                    f127(f35(v0.clone(), {
                        let a488 = v1;
                        let a489 = 1u64;
                        nat_add(a488, a489)?
                    }, 0u64)?, 0u64, f89(f3(v0), {
                        let a490 = v1;
                        let a491 = 1u64;
                        nat_add(a490, a491)?
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

pub fn f92(v0: Bytes) -> bool {
    f108(v0, f128(), 26u64)
}

pub fn f93(v0: Bytes, p499: u64, p500: u64, p501: bool) -> R<bool> {
    let m498 = (p499, (p500, p501));
    {
        let mut m498 = m498;
        loop {
            let step = {
                let (v1, (v2, v3)) = m498;
                let m492 = v2;
                if m492 == 0 {
                    let a493 = v3;
                    Err::<(u64, (u64, bool)), R<bool>>(Ok(bool_not(a493)))
                } else {
                    let v4 = m492 - 1;
                    if f43(f88(v0.clone(), v1, 1u64), Bytes::lit(&[0x2d])) {
                        if v3 {
                            Err::<(u64, (u64, bool)), R<bool>>(Ok(false))
                        } else {
                            Ok::<(u64, (u64, bool)), R<bool>>(({
                                let a494 = v1;
                                let a495 = 1u64;
                                nat_add(a494, a495)?
                            }, (v4, true)))
                        }
                    } else {
                        if if f92(f88(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            f129(f88(v0.clone(), v1, 1u64))
                        } {
                            Ok::<(u64, (u64, bool)), R<bool>>(({
                                let a496 = v1;
                                let a497 = 1u64;
                                nat_add(a496, a497)?
                            }, (v4, false)))
                        } else {
                            Err::<(u64, (u64, bool)), R<bool>>(Ok(false))
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m498 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f94(v0: Str, p506: List<Str>) -> bool {
    let m505 = p506;
    {
        let mut m505 = m505;
        loop {
            let step = {
                let v1 = m505;
                let m502 = v1;
                match m502.uncons() {
                    None => {
                        Err::<List<Str>, bool>(false)
                    }
                    Some((v2, v3)) => {
                        let a503 = v2;
                        let a504 = v0.clone();
                        if equal(a503, a504) {
                            Err::<List<Str>, bool>(true)
                        } else {
                            Ok::<List<Str>, bool>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m505 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f95() -> List<Str> {
    List::cons(Str::lit("bool"), List::cons(Str::lit("u8"), List::cons(Str::lit("s8"), List::cons(Str::lit("u16"), List::cons(Str::lit("s16"), List::cons(Str::lit("u32"), List::cons(Str::lit("s32"), List::cons(Str::lit("char"), List::cons(Str::lit("u64"), List::cons(Str::lit("s64"), List::cons(Str::lit("f32"), List::cons(Str::lit("f64"), List::<Str>::nil()))))))))))))
}

pub fn f96(v0: Bytes) -> R<Adt17> {
    let a507 = f3(f33(v0.clone())?);
    let a508 = 0u64;
    if nat_eq(a507, a508) {
        Ok(Adt17::C0(List::<Adt8>::nil()))
    } else {
        f130(f13(v0, Bytes::lit(&[0x2c]))?)
    }
}

pub fn f97(v0: Bytes) -> R<Str> {
    Ok(f16(f131(v0.clone(), 0u64, f3(v0))?))
}

pub fn f98(v0: Bytes) -> Str {
    f5(List::cons(Str::lit("type "), List::cons(f16(v0), List::cons(Str::lit(" is outside the scalar subset generate reads"), List::<Str>::nil()))))
}

pub fn f99(v0: u64) -> Str {
    f47(f88(f109(), v0, 1u64), Str::lit("0"))
}

pub fn f100(v0: Bytes, v1: u64, v2: Bytes, v3: u64) -> R<Bytes> {
    let m509 = v3;
    if m509 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v4 = m509 - 1;
        let a514 = if f43(f88(v0.clone(), v1, 1u64), Bytes::lit(&[0x5c])) {
            Bytes::lit(&[0x5c, 0x5c])
        } else {
            if f43(f88(v0.clone(), v1, 1u64), v2.clone()) {
                let a510 = Bytes::lit(&[0x5c]);
                let a511 = v2.clone();
                append_bytes(a510, a511)
            } else {
                if f43(f88(v0.clone(), v1, 1u64), Bytes::lit(&[0x0a])) {
                    Bytes::lit(&[0x5c, 0x6e])
                } else {
                    f88(v0.clone(), v1, 1u64)
                }
            }
        };
        let a515 = f100(v0, {
            let a512 = v1;
            let a513 = 1u64;
            nat_add(a512, a513)?
        }, v2, v4)?;
        Ok(append_bytes(a514, a515))
    }
}

pub fn f101(v0: Str) -> R<Str> {
    Ok(f47(f132({
        let a516 = v0.clone();
        utf8_encode(a516)
    }, 0u64, true, {
        let a518 = {
            let a517 = v0.clone();
            utf8_encode(a517)
        };
        length_bytes(a518)
    })?, v0))
}

pub fn f102(v0: Str) -> R<bool> {
    let v1: Bytes = {
        let a519 = v0;
        utf8_encode(a519)
    };
    if f133(f88(v1.clone(), 0u64, 1u64)) {
        f134(v1.clone(), 0u64, f3(v1))
    } else {
        Ok(false)
    }
}

pub fn f103(v0: Adt0) -> R<bool> {
    let a521 = match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h520, _, _, _, _, _, _, _, _, _, _) => {
            h520
        }
    };
    let a522 = Str::lit("prismpm/model-document/1");
    if equal(a521, a522) {
        if f38({
            let a524 = match v0.clone() {
                Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h523, _, _, _, _, _, _, _, _, _) => {
                    h523
                }
            };
            utf8_encode(a524)
        }, Bytes::lit(&[0x41, 0x73, 0x63, 0x69, 0x69, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x49, 0x36, 0x34]))? {
            Ok(true)
        } else {
            f38({
                let a526 = match v0 {
                    Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h525, _, _, _, _, _, _, _, _, _) => {
                        h525
                    }
                };
                utf8_encode(a526)
            }, Bytes::lit(&[0x41, 0x73, 0x63, 0x69, 0x69, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x49, 0x6e, 0x74, 0x36, 0x34]))
        }
    } else {
        Ok(false)
    }
}

pub fn f104(p535: List<Adt1>, p536: List<Str>) -> R<Option<Str>> {
    let m534 = (p535, p536);
    {
        let mut m534 = m534;
        loop {
            let step = {
                let (v0, v1) = m534;
                let m527 = v0;
                match m527.uncons() {
                    None => {
                        Err::<(List<Adt1>, List<Str>), R<Option<Str>>>(Ok(None::<Str>))
                    }
                    Some((v2, v3)) => {
                        if f135(match v2.clone() {
                            Adt1::C0(h528, _, _) => {
                                h528
                            }
                        })? {
                            if f94(f136(match v2.clone() {
                                Adt1::C0(h529, _, _) => {
                                    h529
                                }
                            })?, v1.clone()) {
                                Err::<(List<Adt1>, List<Str>), R<Option<Str>>>(Ok(Some(f5(List::cons(Str::lit("operation "), List::cons(match v2.clone() {
                                    Adt1::C0(h530, _, _) => {
                                        h530
                                    }
                                }, List::cons(Str::lit(" collides with the method "), List::cons(f136(match v2 {
                                    Adt1::C0(h531, _, _) => {
                                        h531
                                    }
                                })?, List::<Str>::nil()))))))))
                            } else {
                                Ok::<(List<Adt1>, List<Str>), R<Option<Str>>>((v3, List::cons(f136(match v2 {
                                    Adt1::C0(h532, _, _) => {
                                        h532
                                    }
                                })?, v1)))
                            }
                        } else {
                            Err::<(List<Adt1>, List<Str>), R<Option<Str>>>(Ok(Some(f5(List::cons(Str::lit("operation "), List::cons(f15(match v2 {
                                Adt1::C0(h533, _, _) => {
                                    h533
                                }
                            })?, List::cons(Str::lit(" is not a request name generate can bind"), List::<Str>::nil())))))))
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m534 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f105(v0: Adt0, v1: Adt6, v2: Str, v3: Str, v4: Adt10) -> R<Adt4> {
    Ok(Adt4::C0(Adt5::C0(match v0.clone() {
        Adt0::C0(h537, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h537
        }
    }, v1, Adt9::C0(v2, v3.clone(), f137(v3)?, match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h538, _, _, _, _, _, _, _, _, _, _, _) => {
            h538
        }
    }, match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h539, _, _, _, _, _, _, _, _, _, _) => {
            h539
        }
    }, match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h540, _, _, _, _, _) => {
            h540
        }
    }, match v0 {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h541, _, _, _, _) => {
            h541
        }
    }, v4))))
}

pub fn f106(v0: List<Adt1>) -> List<Adt12> {
    let m542 = v0;
    match m542.uncons() {
        None => {
            List::<Adt12>::nil()
        }
        Some((v1, v2)) => {
            List::cons(Adt12::C0(match v1.clone() {
                Adt1::C0(h543, _, _) => {
                    h543
                }
            }, match v1.clone() {
                Adt1::C0(_, h544, _) => {
                    h544
                }
            }, match v1 {
                Adt1::C0(_, _, h545) => {
                    h545
                }
            }), f106(v2))
        }
    }
}

pub fn f107(v0: Adt0) -> List<Adt13> {
    List::cons(Adt13::C0(Str::lit("overflow"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h546, _, _) => {
            h546
        }
    }), List::cons(Adt13::C0(Str::lit("division-by-zero"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h547, _) => {
            h547
        }
    }), List::cons(Adt13::C0(Str::lit("malformed-request"), match v0 {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h548) => {
            h548
        }
    }), List::cons(Adt13::C0(Str::lit("unsupported-version"), None::<Str>), List::cons(Adt13::C0(Str::lit("unknown-operation"), None::<Str>), List::<Adt13>::nil())))))
}

pub fn f108(v0: Bytes, v1: Bytes, p551: u64) -> bool {
    let m550 = p551;
    {
        let mut m550 = m550;
        loop {
            let step = {
                let v2 = m550;
                let m549 = v2;
                if m549 == 0 {
                    Err::<u64, bool>(false)
                } else {
                    let v3 = m549 - 1;
                    if f43(f88(v1.clone(), v3, 1u64), v0.clone()) {
                        Err::<u64, bool>(true)
                    } else {
                        Ok::<u64, bool>(v3)
                    }
                }
            };
            match step {
                Ok(next) => { m550 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f109() -> Bytes {
    Bytes::lit(&[0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39])
}

pub fn f110(v0: Bytes, p556: u64, p557: u64) -> R<bool> {
    let m555 = (p556, p557);
    {
        let mut m555 = m555;
        loop {
            let step = {
                let (v1, v2) = m555;
                let m552 = v2;
                if m552 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m552 - 1;
                    if if f113(f88(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        f43(f88(v0.clone(), v1, 1u64), Bytes::lit(&[0x5f]))
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a553 = v1;
                            let a554 = 1u64;
                            nat_add(a553, a554)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m555 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f111(v0: Bytes) -> bool {
    let a558 = f43(f112(v0.clone()), v0);
    bool_not(a558)
}

pub fn f112(v0: Bytes) -> Bytes {
    f138(v0, f139(), f128(), 26u64)
}

pub fn f113(v0: Bytes) -> bool {
    if f108(v0.clone(), f128(), 26u64) {
        true
    } else {
        f108(v0, f109(), 10u64)
    }
}

pub fn f114() -> List<Str> {
    List::cons(Str::lit("as"), List::cons(Str::lit("break"), List::cons(Str::lit("const"), List::cons(Str::lit("continue"), List::cons(Str::lit("crate"), List::cons(Str::lit("else"), List::cons(Str::lit("enum"), List::cons(Str::lit("extern"), List::cons(Str::lit("false"), List::cons(Str::lit("fn"), List::cons(Str::lit("for"), List::cons(Str::lit("if"), List::cons(Str::lit("impl"), List::cons(Str::lit("in"), List::cons(Str::lit("let"), List::cons(Str::lit("loop"), List::cons(Str::lit("match"), List::cons(Str::lit("mod"), List::cons(Str::lit("move"), List::cons(Str::lit("mut"), List::cons(Str::lit("pub"), List::cons(Str::lit("ref"), List::cons(Str::lit("return"), List::cons(Str::lit("self"), List::cons(Str::lit("Self"), List::cons(Str::lit("static"), List::cons(Str::lit("struct"), List::cons(Str::lit("super"), List::cons(Str::lit("trait"), List::cons(Str::lit("true"), List::cons(Str::lit("type"), List::cons(Str::lit("unsafe"), List::cons(Str::lit("use"), List::cons(Str::lit("where"), List::cons(Str::lit("while"), List::cons(Str::lit("async"), List::cons(Str::lit("await"), List::cons(Str::lit("dyn"), List::cons(Str::lit("abstract"), List::cons(Str::lit("become"), List::cons(Str::lit("box"), List::cons(Str::lit("do"), List::cons(Str::lit("final"), List::cons(Str::lit("macro"), List::cons(Str::lit("override"), List::cons(Str::lit("priv"), List::cons(Str::lit("typeof"), List::cons(Str::lit("unsized"), List::cons(Str::lit("virtual"), List::cons(Str::lit("yield"), List::cons(Str::lit("try"), List::cons(Str::lit("gen"), List::<Str>::nil()))))))))))))))))))))))))))))))))))))))))))))))))))))
}

pub fn f115(v0: Str, v1: Str) -> Option<(Str, Str)> {
    Some((Str::lit("generate.model"), f5(List::cons(Str::lit("operation "), List::cons(v0, List::cons(Str::lit(" collides with the method "), List::cons(v1, List::<Str>::nil())))))))
}

pub fn f116(v0: Str, p564: List<Adt13>) -> bool {
    let m563 = p564;
    {
        let mut m563 = m563;
        loop {
            let step = {
                let v1 = m563;
                let m559 = v1;
                match m559.uncons() {
                    None => {
                        Err::<List<Adt13>, bool>(false)
                    }
                    Some((v2, v3)) => {
                        let a561 = match v2 {
                            Adt13::C0(h560, _) => {
                                h560
                            }
                        };
                        let a562 = v0.clone();
                        if equal(a561, a562) {
                            Err::<List<Adt13>, bool>(true)
                        } else {
                            Ok::<List<Adt13>, bool>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m563 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f117(v0: Str, p571: List<(Str, Str)>) -> Option<Str> {
    let m570 = p571;
    {
        let mut m570 = m570;
        loop {
            let step = {
                let v1 = m570;
                let m565 = v1;
                match m565.uncons() {
                    None => {
                        Err::<List<(Str, Str)>, Option<Str>>(None::<Str>)
                    }
                    Some((v2, v3)) => {
                        let a567 = {
                            let (h566, _) = v2;
                            h566
                        };
                        let a568 = v0.clone();
                        if equal(a567, a568) {
                            Err::<List<(Str, Str)>, Option<Str>>(Some({
                                let (_, h569) = v2;
                                h569
                            }))
                        } else {
                            Ok::<List<(Str, Str)>, Option<Str>>(v3)
                        }
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

pub fn f118(v0: Str) -> Str {
    f47(f140({
        let a572 = v0.clone();
        utf8_encode(a572)
    }, {
        let a574 = {
            let a573 = v0.clone();
            utf8_encode(a573)
        };
        length_bytes(a574)
    }), v0)
}

pub fn f119(v0: Str, v1: List<Str>) -> List<Str> {
    let m575 = v1;
    match m575.uncons() {
        None => {
            List::cons(v0, List::<Str>::nil())
        }
        Some((v2, v3)) => {
            if f85(v0.clone(), v2.clone()) {
                List::cons(v0, List::cons(v2, v3))
            } else {
                List::cons(v2, f119(v0, v3))
            }
        }
    }
}

pub fn f120(v0: List<Adt8>) -> R<Str> {
    let m576 = v0;
    match m576.uncons() {
        None => {
            Ok(Str::lit(""))
        }
        Some((v1, v2)) => {
            Ok(f5(List::cons(Str::lit(", "), List::cons(f22(match v1.clone() {
                Adt8::C0(h577, _) => {
                    h577
                }
            })?, List::cons(Str::lit(": "), List::cons(f121(match v1 {
                Adt8::C0(_, h578) => {
                    h578
                }
            }), List::cons(f120(v2)?, List::<Str>::nil())))))))
        }
    }
}

pub fn f121(v0: Str) -> Str {
    let m579 = f117(v0.clone(), f26());
    match m579 {
        None => {
            v0
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f122(v0: Str) -> bool {
    let a581 = {
        let a580 = v0;
        length_string(a580)
    };
    let a582 = 100u64;
    nat_le(a581, a582)
}

pub fn f123(v0: Str, v1: List<Str>, v2: Str) -> List<Str> {
    let m583 = v1;
    match m583.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v3, v4)) => {
            List::cons(f5(List::cons(v0.clone(), List::cons(v3, List::cons(v2.clone(), List::<Str>::nil())))), f123(v0, v4, v2))
        }
    }
}

pub fn f124(v0: Adt9, v1: Str, v2: Adt13) -> Str {
    let m585 = match v2.clone() {
        Adt13::C0(_, h584) => {
            h584
        }
    };
    match m585 {
        None => {
            let a587 = match v2.clone() {
                Adt13::C0(h586, _) => {
                    h586
                }
            };
            let a588 = Str::lit("unsupported-version");
            if equal(a587, a588) {
                f5(List::cons(match v0 {
                    Adt9::C0(h589, _, _, _, _, _, _, _) => {
                        h589
                    }
                }, List::cons(Str::lit(" does not answer request version "), List::cons(v1, List::cons(Str::lit("."), List::<Str>::nil())))))
            } else {
                let a591 = match v2.clone() {
                    Adt13::C0(h590, _) => {
                        h590
                    }
                };
                let a592 = Str::lit("unknown-operation");
                if equal(a591, a592) {
                    f5(List::cons(match v0 {
                        Adt9::C0(h593, _, _, _, _, _, _, _) => {
                            h593
                        }
                    }, List::cons(Str::lit(" does not know this operation."), List::<Str>::nil())))
                } else {
                    f5(List::cons(match v0 {
                        Adt9::C0(h594, _, _, _, _, _, _, _) => {
                            h594
                        }
                    }, List::cons(Str::lit(" refused the request: "), List::cons(match v2 {
                        Adt13::C0(h595, _) => {
                            h595
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

pub fn f125(v0: Bytes) -> bool {
    f108(v0, Bytes::lit(&[0x20, 0x09, 0x0d]), 3u64)
}

pub fn f126(v0: u64, v1: u64, p604: u64, p605: u64) -> R<u64> {
    let m603 = (p604, p605);
    {
        let mut m603 = m603;
        loop {
            let step = {
                let (v2, v3) = m603;
                let m596 = v3;
                if m596 == 0 {
                    Err::<(u64, u64), R<u64>>(Ok(0u64))
                } else {
                    let v4 = m596 - 1;
                    let a599 = {
                        let a597 = v2;
                        let a598 = v1;
                        nat_add(a597, a598)?
                    };
                    let a600 = v0;
                    if nat_eq(a599, a600) {
                        Err::<(u64, u64), R<u64>>(Ok(v2))
                    } else {
                        Ok::<(u64, u64), R<u64>>(({
                            let a601 = v2;
                            let a602 = 1u64;
                            nat_add(a601, a602)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m603 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f127(v0: Bytes, p610: u64, p611: u64) -> R<bool> {
    let m609 = (p610, p611);
    {
        let mut m609 = m609;
        loop {
            let step = {
                let (v1, v2) = m609;
                let m606 = v2;
                if m606 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m606 - 1;
                    if if f92(f88(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        if f133(f88(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            if f129(f88(v0.clone(), v1, 1u64)) {
                                true
                            } else {
                                f108(f88(v0.clone(), v1, 1u64), Bytes::lit(&[0x2e, 0x2b, 0x2d]), 3u64)
                            }
                        }
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a607 = v1;
                            let a608 = 1u64;
                            nat_add(a607, a608)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m609 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f128() -> Bytes {
    Bytes::lit(&[0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a])
}

pub fn f129(v0: Bytes) -> bool {
    f108(v0, f109(), 10u64)
}

pub fn f130(v0: List<Bytes>) -> R<Adt17> {
    let m612 = v0;
    match m612.uncons() {
        None => {
            Ok(Adt17::C0(List::<Adt8>::nil()))
        }
        Some((v1, v2)) => {
            let v3: Bytes = f33(v1)?;
            let m613 = f90(v3.clone(), Bytes::lit(&[0x3a]), 0u64, f3(v3.clone()))?;
            match m613 {
                None => {
                    Ok(Adt17::C1(f5(List::cons(Str::lit("cannot read parameter "), List::cons(f15(f16(v3))?, List::<Str>::nil())))))
                }
                Some(v4) => {
                    let v5: Bytes = f88(v3.clone(), 0u64, v4);
                    let v6: Bytes = f35(v3.clone(), {
                        let a614 = v4;
                        let a615 = 2u64;
                        nat_add(a614, a615)?
                    }, 0u64)?;
                    if if f43(f88(v3.clone(), {
                        let a616 = v4;
                        let a617 = 1u64;
                        nat_add(a616, a617)?
                    }, 1u64), Bytes::lit(&[0x20])) {
                        if f40(v5.clone())? {
                            f40(v6.clone())?
                        } else {
                            false
                        }
                    } else {
                        false
                    } {
                        if f94(f16(v6.clone()), f95()) {
                            let m618 = f130(v2)?;
                            match m618 {
                                Adt17::C0(v7) => {
                                    Ok(Adt17::C0(List::cons(Adt8::C0(f16(v5), f16(v6)), v7)))
                                }
                                Adt17::C1(v8) => {
                                    Ok(Adt17::C1(v8))
                                }
                            }
                        } else {
                            Ok(Adt17::C1(f98(v6)))
                        }
                    } else {
                        Ok(Adt17::C1(f5(List::cons(Str::lit("cannot read parameter "), List::cons(f15(f16(v3))?, List::<Str>::nil())))))
                    }
                }
            }
        }
    }
}

pub fn f131(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let m619 = v2;
    if m619 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v3 = m619 - 1;
        let a622 = if f43(f88(v0.clone(), v1, 1u64), Bytes::lit(&[0x2d])) {
            Bytes::lit(&[0x5f])
        } else {
            f88(v0.clone(), v1, 1u64)
        };
        let a623 = f131(v0, {
            let a620 = v1;
            let a621 = 1u64;
            nat_add(a620, a621)?
        }, v3)?;
        Ok(append_bytes(a622, a623))
    }
}

pub fn f132(v0: Bytes, v1: u64, v2: bool, v3: u64) -> R<Bytes> {
    let m624 = v3;
    if m624 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v4 = m624 - 1;
        if f141(f88(v0.clone(), v1, 1u64)) {
            f132(v0, {
                let a625 = v1;
                let a626 = 1u64;
                nat_add(a625, a626)?
            }, true, v4)
        } else {
            let a629 = if v2 {
                f142(f88(v0.clone(), v1, 1u64))
            } else {
                f88(v0.clone(), v1, 1u64)
            };
            let a630 = f132(v0, {
                let a627 = v1;
                let a628 = 1u64;
                nat_add(a627, a628)?
            }, false, v4)?;
            Ok(append_bytes(a629, a630))
        }
    }
}

pub fn f133(v0: Bytes) -> bool {
    f108(v0, f139(), 26u64)
}

pub fn f134(v0: Bytes, p635: u64, p636: u64) -> R<bool> {
    let m634 = (p635, p636);
    {
        let mut m634 = m634;
        loop {
            let step = {
                let (v1, v2) = m634;
                let m631 = v2;
                if m631 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m631 - 1;
                    if if f92(f88(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        if f133(f88(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            f129(f88(v0.clone(), v1, 1u64))
                        }
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a632 = v1;
                            let a633 = 1u64;
                            nat_add(a632, a633)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m634 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f135(v0: Str) -> R<bool> {
    let v1: Bytes = {
        let a637 = v0;
        utf8_encode(a637)
    };
    if f92(f88(v1.clone(), 0u64, 1u64)) {
        f143(v1.clone(), 0u64, f3(v1))
    } else {
        Ok(false)
    }
}

pub fn f136(v0: Str) -> R<Str> {
    Ok(f47(f132({
        let a638 = v0.clone();
        utf8_encode(a638)
    }, 0u64, false, {
        let a640 = {
            let a639 = v0.clone();
            utf8_encode(a639)
        };
        length_bytes(a640)
    })?, v0))
}

pub fn f137(v0: Str) -> R<Str> {
    Ok(f47(f144({
        let a641 = v0.clone();
        utf8_encode(a641)
    }, 0u64, {
        let a643 = {
            let a642 = v0.clone();
            utf8_encode(a642)
        };
        length_bytes(a643)
    })?, v0))
}

pub fn f138(v0: Bytes, v1: Bytes, v2: Bytes, p646: u64) -> Bytes {
    let m645 = p646;
    {
        let mut m645 = m645;
        loop {
            let step = {
                let v3 = m645;
                let m644 = v3;
                if m644 == 0 {
                    Err::<u64, Bytes>(v0.clone())
                } else {
                    let v4 = m644 - 1;
                    if f43(f88(v1.clone(), v4, 1u64), v0.clone()) {
                        Err::<u64, Bytes>(f88(v2.clone(), v4, 1u64))
                    } else {
                        Ok::<u64, Bytes>(v4)
                    }
                }
            };
            match step {
                Ok(next) => { m645 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f139() -> Bytes {
    Bytes::lit(&[0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a])
}

pub fn f140(p649: Bytes, p650: u64) -> Bytes {
    let m648 = (p649, p650);
    {
        let mut m648 = m648;
        loop {
            let step = {
                let (v0, v1) = m648;
                let m647 = v1;
                if m647 == 0 {
                    Err::<(Bytes, u64), Bytes>(Bytes::lit(&[]))
                } else {
                    let v2 = m647 - 1;
                    if f43(f88(v0.clone(), v2, 1u64), Bytes::lit(&[0x20])) {
                        Ok::<(Bytes, u64), Bytes>((f88(v0, 0u64, v2), v2))
                    } else {
                        Err::<(Bytes, u64), Bytes>(v0)
                    }
                }
            };
            match step {
                Ok(next) => { m648 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f141(v0: Bytes) -> bool {
    if f43(v0.clone(), Bytes::lit(&[0x2d])) {
        true
    } else {
        f43(v0, Bytes::lit(&[0x5f]))
    }
}

pub fn f142(v0: Bytes) -> Bytes {
    f138(v0, f128(), f139(), 26u64)
}

pub fn f143(v0: Bytes, p655: u64, p656: u64) -> R<bool> {
    let m654 = (p655, p656);
    {
        let mut m654 = m654;
        loop {
            let step = {
                let (v1, v2) = m654;
                let m651 = v2;
                if m651 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m651 - 1;
                    if if f92(f88(v0.clone(), v1, 1u64)) {
                        true
                    } else {
                        if f129(f88(v0.clone(), v1, 1u64)) {
                            true
                        } else {
                            f43(f88(v0.clone(), v1, 1u64), Bytes::lit(&[0x2d]))
                        }
                    } {
                        Ok::<(u64, u64), R<bool>>(({
                            let a652 = v1;
                            let a653 = 1u64;
                            nat_add(a652, a653)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m654 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f144(v0: Bytes, v1: u64, v2: u64) -> R<Bytes> {
    let m657 = v2;
    if m657 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v3 = m657 - 1;
        if f111(f88(v0.clone(), v1, 1u64)) {
            let a664 = {
                let a658 = v1;
                let a659 = 0u64;
                if nat_eq(a658, a659) {
                    f112(f88(v0.clone(), v1, 1u64))
                } else {
                    let a660 = Bytes::lit(&[0x2d]);
                    let a661 = f112(f88(v0.clone(), v1, 1u64));
                    append_bytes(a660, a661)
                }
            };
            let a665 = f144(v0, {
                let a662 = v1;
                let a663 = 1u64;
                nat_add(a662, a663)?
            }, v3)?;
            Ok(append_bytes(a664, a665))
        } else {
            let a668 = f88(v0.clone(), v1, 1u64);
            let a669 = f144(v0, {
                let a666 = v1;
                let a667 = 1u64;
                nat_add(a666, a667)?
            }, v3)?;
            Ok(append_bytes(a668, a669))
        }
    }
}

pub fn run(p0: Adt0) -> R<Adt2> {
    f0(p0)
}
