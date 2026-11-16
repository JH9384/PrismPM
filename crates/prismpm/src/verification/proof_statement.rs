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
    C0(Str, Str, Str, Str, Str, Str, Str, Str, Str, Str, Str, Str, Str, Str, Str, Str, Str, Str, Str, List<Adt1>, List<Adt2>, List<u64>, Str, Str, Str),
}

#[derive(Clone)]
pub enum Adt1 {
    C0(Str, Str),
}

#[derive(Clone)]
pub enum Adt2 {
    C0(Str, Str, Str, Str, List<Str>, List<Str>),
}

#[derive(Clone)]
pub enum Adt3 {
    C0(Str),
    C1(Str, Str),
}

pub fn f0(v0: Adt0) -> R<Adt3> {
    let m1 = f1(v0.clone())?;
    match m1 {
        None => {
            Ok(Adt3::C0(f2(v0)?))
        }
        Some(v1) => {
            Ok(Adt3::C1({
                let (h2, _) = v1;
                h2
            }, {
                let (_, h3) = v1;
                h3
            }))
        }
    }
}

pub fn f1(v0: Adt0) -> R<Option<(Str, Str)>> {
    Ok(f3(f4(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h4, _, _, _, _) => {
            h4
        }
    }), f3(f5(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h5, _, _, _, _, _) => {
            h5
        }
    }), f3(f6(List::cons(match v0.clone() {
        Adt0::C0(h6, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h6
        }
    }, List::cons(match v0.clone() {
        Adt0::C0(_, _, h7, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h7
        }
    }, List::cons(match v0.clone() {
        Adt0::C0(_, _, _, _, h8, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h8
        }
    }, List::cons(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, h9, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h9
        }
    }, List::cons(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, h10, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h10
        }
    }, List::cons(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, h11, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h11
        }
    }, List::cons(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, h12, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h12
        }
    }, List::cons(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, h13, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h13
        }
    }, List::cons(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h14) => {
            h14
        }
    }, {
        let a17 = f7(match v0.clone() {
            Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h15, _, _, _, _, _) => {
                h15
            }
        });
        let a18 = f8(match v0.clone() {
            Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h16, _, _, _, _) => {
                h16
            }
        });
        append_list(a17, a18)
    }))))))))))?, f3(f9(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, h19, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h19
        }
    })?, f3(f10(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h20, _, _, _, _, _) => {
            h20
        }
    })?, f3(f11(Str::lit("subject.sha256"), match v0.clone() {
        Adt0::C0(_, h21, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h21
        }
    }, 64u64)?, f3(f11(Str::lit("verifier.lean.commit"), match v0.clone() {
        Adt0::C0(_, _, _, h22, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h22
        }
    }, 40u64)?, f3(f11(Str::lit("verifier.lexlean.commit"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, h23, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h23
        }
    }, 40u64)?, f3(f11(Str::lit("verifier.lexlean.crateSha256"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, h24, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h24
        }
    }, 64u64)?, f3(f11(Str::lit("the lean4-prod commit"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, h25, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h25
        }
    }, 40u64)?, f3(f11(Str::lit("model.snapshotId"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, h26, _, _, _, _, _, _, _, _, _, _, _) => {
            h26
        }
    }, 64u64)?, f3(f11(Str::lit("model.document.sha256"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h27, _, _, _, _, _, _, _, _, _, _) => {
            h27
        }
    }, 64u64)?, f3(f11(Str::lit("model.sourceId"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h28, _, _, _, _, _, _, _, _, _) => {
            h28
        }
    }, 64u64)?, f3(f11(Str::lit("model.semanticId"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h29, _, _, _, _, _, _, _, _) => {
            h29
        }
    }, 64u64)?, f3(f11(Str::lit("model.compilerSemanticsId"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h30, _, _, _, _, _, _, _) => {
            h30
        }
    }, 64u64)?, f3(f11(Str::lit("model.leanManifestSha256"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h31, _, _, _, _, _, _) => {
            h31
        }
    }, 64u64)?, f3(f11(Str::lit("evidence.lexleanAttestation.sha256"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h32, _, _) => {
            h32
        }
    }, 64u64)?, f11(Str::lit("evidence.verificationManifest.sha256"), match v0 {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h33, _) => {
            h33
        }
    }, 64u64)?))))))))))))))))))
}

pub fn f2(v0: Adt0) -> R<Str> {
    Ok(f12(List::cons(f13(Str::lit("_type"), f14(Str::lit("https://in-toto.io/Statement/v1"))?)?, List::cons(f13(Str::lit("predicate"), f15(v0.clone())?)?, List::cons(f13(Str::lit("predicateType"), f14(Str::lit("https://uor.foundation/prism/proof/v1"))?)?, List::cons(f13(Str::lit("subject"), f16(List::cons(f12(List::cons(f13(Str::lit("digest"), f17(match v0.clone() {
        Adt0::C0(_, h34, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h34
        }
    })?)?, List::cons(f13(Str::lit("name"), f14(match v0 {
        Adt0::C0(h35, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h35
        }
    })?)?, List::<Str>::nil()))), List::<Str>::nil())))?, List::<Str>::nil()))))))
}

pub fn f3(v0: Option<(Str, Str)>, v1: Option<(Str, Str)>) -> Option<(Str, Str)> {
    let m36 = v0.clone();
    match m36 {
        None => {
            v1
        }
        Some(_) => {
            v0
        }
    }
}

pub fn f4(v0: List<Adt2>) -> Option<(Str, Str)> {
    let m37 = v0;
    match m37.uncons() {
        None => {
            Some((Str::lit("proof.theorems"), Str::lit("the model declares no theorem, and a proof statement that lists none claims nothing")))
        }
        Some((_, _)) => {
            None::<(Str, Str)>
        }
    }
}

pub fn f5(v0: List<Adt1>) -> Option<(Str, Str)> {
    let m38 = v0;
    match m38.uncons() {
        None => {
            Some((Str::lit("proof.input"), Str::lit("the build lists no generated Lean module")))
        }
        Some((_, _)) => {
            None::<(Str, Str)>
        }
    }
}

pub fn f6(p41: List<Str>) -> R<Option<(Str, Str)>> {
    let m40 = p41;
    {
        let mut m40 = m40;
        loop {
            let step = {
                let v0 = m40;
                let m39 = v0;
                match m39.uncons() {
                    None => {
                        Err::<List<Str>, R<Option<(Str, Str)>>>(Ok(None::<(Str, Str)>))
                    }
                    Some((v1, v2)) => {
                        if f18(v1.clone())? {
                            Ok::<List<Str>, R<Option<(Str, Str)>>>(v2)
                        } else {
                            Err::<List<Str>, R<Option<(Str, Str)>>>(Ok(Some((Str::lit("proof.input"), f19(List::cons(Str::lit("the text "), List::cons(f20(v1)?, List::cons(Str::lit(" is empty or holds a control character"), List::<Str>::nil()))))))))
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m40 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f7(v0: List<Adt1>) -> List<Str> {
    let m42 = v0;
    match m42.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(match v1 {
                Adt1::C0(h43, _) => {
                    h43
                }
            }, f7(v2))
        }
    }
}

pub fn f8(v0: List<Adt2>) -> List<Str> {
    let m44 = v0;
    match m44.uncons() {
        None => {
            List::<Str>::nil()
        }
        Some((v1, v2)) => {
            List::cons(match v1.clone() {
                Adt2::C0(h45, _, _, _, _, _) => {
                    h45
                }
            }, List::cons(match v1.clone() {
                Adt2::C0(_, h46, _, _, _, _) => {
                    h46
                }
            }, List::cons(match v1.clone() {
                Adt2::C0(_, _, h47, _, _, _) => {
                    h47
                }
            }, List::cons(match v1.clone() {
                Adt2::C0(_, _, _, h48, _, _) => {
                    h48
                }
            }, {
                let a53 = match v1.clone() {
                    Adt2::C0(_, _, _, _, h49, _) => {
                        h49
                    }
                };
                let a54 = {
                    let a51 = match v1 {
                        Adt2::C0(_, _, _, _, _, h50) => {
                            h50
                        }
                    };
                    let a52 = f8(v2);
                    append_list(a51, a52)
                };
                append_list(a53, a54)
            }))))
        }
    }
}

pub fn f9(v0: Str) -> R<Option<(Str, Str)>> {
    let m55 = f21(v0.clone())?;
    match m55 {
        None => {
            Ok(Some((Str::lit("proof.input"), f19(List::cons(Str::lit("the SDK image "), List::cons(f20(v0)?, List::cons(Str::lit(" is not pinned as <repository>@sha256:<64 hex>"), List::<Str>::nil())))))))
        }
        Some(_) => {
            Ok(None::<(Str, Str)>)
        }
    }
}

pub fn f10(v0: List<Adt1>) -> R<Option<(Str, Str)>> {
    let m56 = v0;
    match m56.uncons() {
        None => {
            Ok(None::<(Str, Str)>)
        }
        Some((v1, v2)) => {
            let m58 = f22(match v1.clone() {
                Adt1::C0(h57, _) => {
                    h57
                }
            })?;
            match m58 {
                None => {
                    Ok(Some((Str::lit("proof.input"), f19(List::cons(f20(match v1 {
                        Adt1::C0(h59, _) => {
                            h59
                        }
                    })?, List::cons(Str::lit(" is not a generated Lean module path, lexlean/build/modules/<module>.lean"), List::<Str>::nil()))))))
                }
                Some(v3) => {
                    Ok(f3(f11(f19(List::cons(Str::lit("the SHA-256 of "), List::cons(v3, List::<Str>::nil()))), match v1 {
                        Adt1::C0(_, h60) => {
                            h60
                        }
                    }, 64u64)?, f10(v2)?))
                }
            }
        }
    }
}

pub fn f11(v0: Str, v1: Str, v2: u64) -> R<Option<(Str, Str)>> {
    if f23(v1, v2)? {
        Ok(None::<(Str, Str)>)
    } else {
        Ok(Some((Str::lit("proof.input"), f19(List::cons(v0, List::cons(Str::lit(" is not "), List::cons(f24(v2)?, List::cons(Str::lit(" lowercase hex characters"), List::<Str>::nil()))))))))
    }
}

pub fn f12(v0: List<Str>) -> Str {
    f19(List::cons(Str::lit("{"), List::cons({
        let a61 = v0;
        let a62 = Str::lit(",");
        join(a61, a62)
    }, List::cons(Str::lit("}"), List::<Str>::nil()))))
}

pub fn f13(v0: Str, v1: Str) -> R<Str> {
    Ok(f19(List::cons(f14(v0)?, List::cons(Str::lit(":"), List::cons(v1, List::<Str>::nil())))))
}

pub fn f14(v0: Str) -> R<Str> {
    f20(v0)
}

pub fn f15(v0: Adt0) -> R<Str> {
    Ok(f12(List::cons(f13(Str::lit("evidence"), f12(List::cons(f13(Str::lit("lexleanAttestation"), f17(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h63, _, _) => {
            h63
        }
    })?)?, List::cons(f13(Str::lit("verificationManifest"), f17(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h64, _) => {
            h64
        }
    })?)?, List::<Str>::nil()))))?, List::cons(f13(Str::lit("model"), f12(List::cons(f13(Str::lit("compilerSemanticsId"), f14(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h65, _, _, _, _, _, _, _) => {
            h65
        }
    })?)?, List::cons(f13(Str::lit("document"), f17(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h66, _, _, _, _, _, _, _, _, _, _) => {
            h66
        }
    })?)?, List::cons(f13(Str::lit("leanManifestSha256"), f14(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h67, _, _, _, _, _, _) => {
            h67
        }
    })?)?, List::cons(f13(Str::lit("modules"), f16(f25(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h68, _, _, _, _, _) => {
            h68
        }
    })?))?, List::cons(f13(Str::lit("semanticId"), f14(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h69, _, _, _, _, _, _, _, _) => {
            h69
        }
    })?)?, List::cons(f13(Str::lit("snapshotId"), f14(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, h70, _, _, _, _, _, _, _, _, _, _, _) => {
            h70
        }
    })?)?, List::cons(f13(Str::lit("sourceId"), f14(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h71, _, _, _, _, _, _, _, _, _) => {
            h71
        }
    })?)?, List::<Str>::nil())))))))))?, List::cons(f13(Str::lit("policy"), f12(List::cons(f13(Str::lit("digest"), f17(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, h72, _, _, _, _, _, _, _, _, _, _, _) => {
            h72
        }
    })?)?, List::cons(f13(Str::lit("uri"), f14(Str::lit("https://uor.foundation/prism/proof/v1/policy/axiom-audit"))?)?, List::<Str>::nil()))))?, List::cons(f13(Str::lit("tcb"), f26(v0.clone())?)?, List::cons(f13(Str::lit("theorems"), f16(f27(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h73, _, _, _, _) => {
            h73
        }
    })?))?, List::cons(f13(Str::lit("timeVerified"), f14(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h74) => {
            h74
        }
    })?)?, List::cons(f13(Str::lit("verificationResult"), f14(f28(if f29(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h75, _, _, _, _) => {
            h75
        }
    }) {
        f30(match v0.clone() {
            Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h76, _, _, _) => {
                h76
            }
        })
    } else {
        false
    }))?)?, List::cons(f13(Str::lit("verifiedLevels"), f31(List::cons(Str::lit("P2"), List::<Str>::nil()))?)?, List::cons(f13(Str::lit("verifier"), f12(List::cons(f13(Str::lit("id"), f14(Str::lit("https://uor.foundation/prism/verifier/lean4"))?)?, List::cons(f13(Str::lit("lean"), f12(List::cons(f13(Str::lit("commit"), f14(match v0.clone() {
        Adt0::C0(_, _, _, h77, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h77
        }
    })?)?, List::cons(f13(Str::lit("version"), f14(f19(List::cons(Str::lit("v"), List::cons(match v0.clone() {
        Adt0::C0(_, _, h78, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h78
        }
    }, List::<Str>::nil()))))?)?, List::<Str>::nil()))))?, List::cons(f13(Str::lit("lexlean"), f12(List::cons(f13(Str::lit("commit"), f14(match v0.clone() {
        Adt0::C0(_, _, _, _, _, h79, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h79
        }
    })?)?, List::cons(f13(Str::lit("crateSha256"), f14(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, h80, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h80
        }
    })?)?, List::cons(f13(Str::lit("version"), f14(match v0.clone() {
        Adt0::C0(_, _, _, _, h81, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h81
        }
    })?)?, List::<Str>::nil())))))?, List::cons(f13(Str::lit("prismpm"), f12(List::cons(f13(Str::lit("version"), f14(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, h82, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h82
        }
    })?)?, List::<Str>::nil())))?, List::cons(f13(Str::lit("sdkImage"), f14(match v0 {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, h83, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h83
        }
    })?)?, List::<Str>::nil())))))))?, List::<Str>::nil())))))))))))
}

pub fn f16(v0: List<Str>) -> Str {
    f19(List::cons(Str::lit("["), List::cons({
        let a84 = v0;
        let a85 = Str::lit(",");
        join(a84, a85)
    }, List::cons(Str::lit("]"), List::<Str>::nil()))))
}

pub fn f17(v0: Str) -> R<Str> {
    Ok(f12(List::cons(f13(Str::lit("sha256"), f14(v0)?)?, List::<Str>::nil())))
}

pub fn f18(v0: Str) -> R<bool> {
    let a88 = {
        let a87 = {
            let a86 = v0.clone();
            utf8_encode(a86)
        };
        length_bytes(a87)
    };
    let a89 = 0u64;
    if nat_eq(a88, a89) {
        Ok(false)
    } else {
        f32({
            let a90 = v0.clone();
            utf8_encode(a90)
        }, 0u64, {
            let a92 = {
                let a91 = v0;
                utf8_encode(a91)
            };
            length_bytes(a92)
        })
    }
}

pub fn f19(v0: List<Str>) -> Str {
    let a93 = v0;
    let a94 = Str::lit("");
    join(a93, a94)
}

pub fn f20(v0: Str) -> R<Str> {
    f33(v0, Bytes::lit(&[0x22]))
}

pub fn f21(v0: Str) -> R<Option<Str>> {
    let a97 = {
        let a96 = {
            let a95 = v0.clone();
            utf8_encode(a95)
        };
        length_bytes(a96)
    };
    let a98 = 73u64;
    if nat_lt(a97, a98) {
        Ok(None::<Str>)
    } else {
        f34({
            let a99 = v0.clone();
            utf8_encode(a99)
        }, 1u64, {
            let a101 = {
                let a100 = v0;
                utf8_encode(a100)
            };
            length_bytes(a101)
        })
    }
}

pub fn f22(v0: Str) -> R<Option<Str>> {
    let v1: Bytes = {
        let a102 = v0;
        utf8_encode(a102)
    };
    if f35(f36(v1.clone(), 0u64, 22u64), f37()) {
        let m104 = f38(v1.clone(), 22u64, {
            let a103 = v1;
            length_bytes(a103)
        })?;
        match m104 {
            None => {
                Ok(None::<Str>)
            }
            Some(v2) => {
                let a106 = {
                    let a105 = v2.clone();
                    length_bytes(a105)
                };
                let a107 = 0u64;
                if nat_eq(a106, a107) {
                    Ok(None::<Str>)
                } else {
                    let a108 = v2;
                    Ok(utf8_decode(a108))
                }
            }
        }
    } else {
        Ok(None::<Str>)
    }
}

pub fn f23(v0: Str, v1: u64) -> R<bool> {
    let a111 = {
        let a110 = {
            let a109 = v0.clone();
            utf8_encode(a109)
        };
        length_bytes(a110)
    };
    let a112 = v1;
    if nat_eq(a111, a112) {
        f39({
            let a113 = v0;
            utf8_encode(a113)
        }, 0u64, v1)
    } else {
        Ok(false)
    }
}

pub fn f24(v0: u64) -> R<Str> {
    Ok(f40(v0, {
        let a114 = v0;
        let a115 = 1u64;
        nat_add(a114, a115)?
    }))
}

pub fn f25(v0: List<Adt1>) -> R<List<Str>> {
    let m116 = v0;
    match m116.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            Ok(List::cons(f12(List::cons(f13(Str::lit("leanSha256"), f14(match v1.clone() {
                Adt1::C0(_, h117) => {
                    h117
                }
            })?)?, List::cons(f13(Str::lit("name"), f14({
                let m119 = f22(match v1.clone() {
                    Adt1::C0(h118, _) => {
                        h118
                    }
                })?;
                match m119 {
                    None => {
                        match v1 {
                            Adt1::C0(h120, _) => {
                                h120
                            }
                        }
                    }
                    Some(v3) => {
                        v3
                    }
                }
            })?)?, List::<Str>::nil()))), f25(v2)?))
        }
    }
}

pub fn f26(v0: Adt0) -> R<Str> {
    let v1: Str = f19(List::cons(Str::lit("leanprover/lean4:v"), List::cons(match v0.clone() {
        Adt0::C0(_, _, h121, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h121
        }
    }, List::<Str>::nil())));
    Ok(f16(List::cons(f41(Str::lit("lean4-kernel"), Some(match v0.clone() {
        Adt0::C0(_, _, _, h122, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h122
        }
    }), Str::lit("type-checks every listed theorem; the verdict is its acceptance"), v1.clone())?, List::cons(f41(Str::lit("leanchecker"), None::<Str>, Str::lit("replays each module environment through the same kernel; not independent of it"), v1)?, List::cons(f41(Str::lit("lexlean"), Some(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, h123, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h123
        }
    }), Str::lit("translates .lex.tex into the Lean that was checked"), match v0.clone() {
        Adt0::C0(_, _, _, _, h124, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h124
        }
    })?, List::cons(f41(Str::lit("lean4-prod"), None::<Str>, Str::lit("exports LCNF from the checked Lean and renders the Rust core"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, h125, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h125
        }
    })?, List::cons(f41(Str::lit("rustc"), None::<Str>, Str::lit("compiles the Rust core to the Core-Wasm guest, the subject"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, h126, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h126
        }
    })?, List::cons(f41(Str::lit("wasm-bindgen-cli"), None::<Str>, Str::lit("generates the browser adapter around the guest; outside the subject"), match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, h127, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h127
        }
    })?, List::cons(f41(Str::lit("sdk-image"), f21(match v0.clone() {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, h128, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h128
        }
    })?, Str::lit("hosts every step above; pinned in prismpm.lock"), match v0 {
        Adt0::C0(_, _, _, _, _, _, _, _, _, _, _, _, h129, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h129
        }
    })?, List::<Str>::nil())))))))))
}

pub fn f27(v0: List<Adt2>) -> R<List<Str>> {
    let m130 = v0;
    match m130.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            Ok(List::cons(f42(v1)?, f27(v2)?))
        }
    }
}

pub fn f28(v0: bool) -> Str {
    if v0 {
        Str::lit("PASSED")
    } else {
        Str::lit("FAILED")
    }
}

pub fn f29(p133: List<Adt2>) -> bool {
    let m132 = p133;
    {
        let mut m132 = m132;
        loop {
            let step = {
                let v0 = m132;
                let m131 = v0;
                match m131.uncons() {
                    None => {
                        Err::<List<Adt2>, bool>(true)
                    }
                    Some((v1, v2)) => {
                        if f43(v1) {
                            Ok::<List<Adt2>, bool>(v2)
                        } else {
                            Err::<List<Adt2>, bool>(false)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m132 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f30(p138: List<u64>) -> bool {
    let m137 = p138;
    {
        let mut m137 = m137;
        loop {
            let step = {
                let v0 = m137;
                let m134 = v0;
                match m134.uncons() {
                    None => {
                        Err::<List<u64>, bool>(true)
                    }
                    Some((v1, v2)) => {
                        let a135 = v1;
                        let a136 = 0u64;
                        if nat_eq(a135, a136) {
                            Ok::<List<u64>, bool>(v2)
                        } else {
                            Err::<List<u64>, bool>(false)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m137 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f31(v0: List<Str>) -> R<Str> {
    Ok(f16(f44(v0)?))
}

pub fn f32(v0: Bytes, p143: u64, p144: u64) -> R<bool> {
    let m142 = (p143, p144);
    {
        let mut m142 = m142;
        loop {
            let step = {
                let (v1, v2) = m142;
                let m139 = v2;
                if m139 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m139 - 1;
                    if f45(f36(v0.clone(), v1, 1u64), Bytes::lit(&[0x20])) {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    } else {
                        Ok::<(u64, u64), R<bool>>(({
                            let a140 = v1;
                            let a141 = 1u64;
                            nat_add(a140, a141)?
                        }, v3))
                    }
                }
            };
            match step {
                Ok(next) => { m142 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f33(v0: Str, v1: Bytes) -> R<Str> {
    Ok(f46({
        let a150 = {
            let a148 = v1.clone();
            let a149 = f47({
                let a145 = v0.clone();
                utf8_encode(a145)
            }, 0u64, v1.clone(), {
                let a147 = {
                    let a146 = v0.clone();
                    utf8_encode(a146)
                };
                length_bytes(a147)
            })?;
            append_bytes(a148, a149)
        };
        let a151 = v1;
        append_bytes(a150, a151)
    }, v0))
}

pub fn f34(v0: Bytes, p163: u64, p164: u64) -> R<Option<Str>> {
    let m162 = (p163, p164);
    {
        let mut m162 = m162;
        loop {
            let step = {
                let (v1, v2) = m162;
                let m152 = v2;
                if m152 == 0 {
                    Err::<(u64, u64), R<Option<Str>>>(Ok(None::<Str>))
                } else {
                    let v3 = m152 - 1;
                    if if f35(f36(v0.clone(), v1, 8u64), Bytes::lit(&[0x40, 0x73, 0x68, 0x61, 0x32, 0x35, 0x36, 0x3a])) {
                        if f35(f36(v0.clone(), {
                            let a153 = v1;
                            let a154 = 72u64;
                            nat_add(a153, a154)?
                        }, 1u64), Bytes::lit(&[])) {
                            f39(f36(v0.clone(), {
                                let a155 = v1;
                                let a156 = 8u64;
                                nat_add(a155, a156)?
                            }, 64u64), 0u64, 64u64)?
                        } else {
                            false
                        }
                    } else {
                        false
                    } {
                        let a159 = f36(v0.clone(), {
                            let a157 = v1;
                            let a158 = 8u64;
                            nat_add(a157, a158)?
                        }, 64u64);
                        Err::<(u64, u64), R<Option<Str>>>(Ok(utf8_decode(a159)))
                    } else {
                        Ok::<(u64, u64), R<Option<Str>>>(({
                            let a160 = v1;
                            let a161 = 1u64;
                            nat_add(a160, a161)?
                        }, v3))
                    }
                }
            };
            match step {
                Ok(next) => { m162 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f35(v0: Bytes, v1: Bytes) -> bool {
    let a169 = {
        let a165 = v0;
        let a166 = v1;
        compare_bytes(a165, a166)
    };
    let a170 = {
        let a167 = Bytes::lit(&[0x00]);
        let a168 = Bytes::lit(&[0x00]);
        compare_bytes(a167, a168)
    };
    equal(a169, a170)
}

pub fn f36(v0: Bytes, v1: u64, v2: u64) -> Bytes {
    let m174 = {
        let a171 = v0;
        let a172 = v1;
        let a173 = v2;
        slice_bytes(a171, a172, a173)
    };
    match m174 {
        None => {
            Bytes::lit(&[])
        }
        Some(v3) => {
            v3
        }
    }
}

pub fn f37() -> Bytes {
    Bytes::lit(&[0x6c, 0x65, 0x78, 0x6c, 0x65, 0x61, 0x6e, 0x2f, 0x62, 0x75, 0x69, 0x6c, 0x64, 0x2f, 0x6d, 0x6f, 0x64, 0x75, 0x6c, 0x65, 0x73, 0x2f])
}

pub fn f38(v0: Bytes, v1: u64, v2: u64) -> R<Option<Bytes>> {
    let m175 = v2;
    if m175 == 0 {
        Ok(None::<Bytes>)
    } else {
        let v3 = m175 - 1;
        if if f35(f36(v0.clone(), v1, 5u64), Bytes::lit(&[0x2e, 0x6c, 0x65, 0x61, 0x6e])) {
            f35(f36(v0.clone(), {
                let a176 = v1;
                let a177 = 5u64;
                nat_add(a176, a177)?
            }, 1u64), Bytes::lit(&[]))
        } else {
            false
        } {
            Ok(Some(Bytes::lit(&[])))
        } else {
            if f35(f36(v0.clone(), v1, 1u64), Bytes::lit(&[])) {
                Ok(None::<Bytes>)
            } else {
                let m180 = f38(v0.clone(), {
                    let a178 = v1;
                    let a179 = 1u64;
                    nat_add(a178, a179)?
                }, v3)?;
                match m180 {
                    None => {
                        Ok(None::<Bytes>)
                    }
                    Some(v4) => {
                        Ok(Some({
                            let a181 = if f35(f36(v0.clone(), v1, 1u64), Bytes::lit(&[0x2f])) {
                                Bytes::lit(&[0x2e])
                            } else {
                                f36(v0, v1, 1u64)
                            };
                            let a182 = v4;
                            append_bytes(a181, a182)
                        }))
                    }
                }
            }
        }
    }
}

pub fn f39(v0: Bytes, p187: u64, p188: u64) -> R<bool> {
    let m186 = (p187, p188);
    {
        let mut m186 = m186;
        loop {
            let step = {
                let (v1, v2) = m186;
                let m183 = v2;
                if m183 == 0 {
                    Err::<(u64, u64), R<bool>>(Ok(true))
                } else {
                    let v3 = m183 - 1;
                    if f48(f36(v0.clone(), v1, 1u64), f49(), 16u64) {
                        Ok::<(u64, u64), R<bool>>(({
                            let a184 = v1;
                            let a185 = 1u64;
                            nat_add(a184, a185)?
                        }, v3))
                    } else {
                        Err::<(u64, u64), R<bool>>(Ok(false))
                    }
                }
            };
            match step {
                Ok(next) => { m186 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f40(v0: u64, v1: u64) -> Str {
    let m189 = v1;
    if m189 == 0 {
        Str::lit("")
    } else {
        let v2 = m189 - 1;
        let a190 = v0;
        let a191 = 10u64;
        if nat_lt(a190, a191) {
            f50(v0)
        } else {
            f19(List::cons(f40({
                let a192 = v0;
                let a193 = 10u64;
                let a194 = 0u64;
                nat_quot(a192, a193, a194)
            }, v2), List::cons(f50({
                let a195 = v0;
                let a196 = 10u64;
                let a197 = 0u64;
                nat_rem(a195, a196, a197)
            }), List::<Str>::nil())))
        }
    }
}

pub fn f41(v0: Str, v1: Option<Str>, v2: Str, v3: Str) -> R<Str> {
    Ok(f12(List::cons(f13(Str::lit("component"), f14(v0)?)?, {
        let a199 = {
            let m198 = v1;
            match m198 {
                None => {
                    List::<Str>::nil()
                }
                Some(v4) => {
                    List::cons(f13(Str::lit("digest"), f14(v4)?)?, List::<Str>::nil())
                }
            }
        };
        let a200 = List::cons(f13(Str::lit("role"), f14(v2)?)?, List::cons(f13(Str::lit("trust"), f14(Str::lit("trusted"))?)?, List::cons(f13(Str::lit("version"), f14(v3)?)?, List::<Str>::nil())));
        append_list(a199, a200)
    })))
}

pub fn f42(v0: Adt2) -> R<Str> {
    Ok(f12(List::cons(f13(Str::lit("axioms"), f12(List::cons(f13(Str::lit("observed"), f31(match v0.clone() {
        Adt2::C0(_, _, _, _, _, h201) => {
            h201
        }
    })?)?, List::cons(f13(Str::lit("policy"), f12(List::cons(f13(Str::lit("axioms"), f31(match v0.clone() {
        Adt2::C0(_, _, _, _, h202, _) => {
            h202
        }
    })?)?, List::cons(f13(Str::lit("kind"), f14(match v0.clone() {
        Adt2::C0(_, _, _, h203, _, _) => {
            h203
        }
    })?)?, List::<Str>::nil()))))?, List::<Str>::nil()))))?, List::cons(f13(Str::lit("module"), f14(match v0.clone() {
        Adt2::C0(_, h204, _, _, _, _) => {
            h204
        }
    })?)?, List::cons(f13(Str::lit("name"), f14(match v0.clone() {
        Adt2::C0(h205, _, _, _, _, _) => {
            h205
        }
    })?)?, List::cons(f13(Str::lit("verdict"), f14(f28(f43(v0)))?)?, List::<Str>::nil()))))))
}

pub fn f43(v0: Adt2) -> bool {
    let a207 = match v0.clone() {
        Adt2::C0(_, _, h206, _, _, _) => {
            h206
        }
    };
    let a208 = Str::lit("ok");
    if equal(a207, a208) {
        f51(match v0.clone() {
            Adt2::C0(_, _, _, h209, _, _) => {
                h209
            }
        }, match v0.clone() {
            Adt2::C0(_, _, _, _, h210, _) => {
                h210
            }
        }, match v0 {
            Adt2::C0(_, _, _, _, _, h211) => {
                h211
            }
        })
    } else {
        false
    }
}

pub fn f44(v0: List<Str>) -> R<List<Str>> {
    let m212 = v0;
    match m212.uncons() {
        None => {
            Ok(List::<Str>::nil())
        }
        Some((v1, v2)) => {
            Ok(List::cons(f20(v1)?, f44(v2)?))
        }
    }
}

pub fn f45(v0: Bytes, v1: Bytes) -> bool {
    let a217 = {
        let a213 = v0;
        let a214 = v1;
        compare_bytes(a213, a214)
    };
    let a218 = {
        let a215 = Bytes::lit(&[0x00]);
        let a216 = Bytes::lit(&[0x01]);
        compare_bytes(a215, a216)
    };
    equal(a217, a218)
}

pub fn f46(v0: Bytes, v1: Str) -> Str {
    let m220 = {
        let a219 = v0;
        utf8_decode(a219)
    };
    match m220 {
        None => {
            v1
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f47(v0: Bytes, v1: u64, v2: Bytes, v3: u64) -> R<Bytes> {
    let m221 = v3;
    if m221 == 0 {
        Ok(Bytes::lit(&[]))
    } else {
        let v4 = m221 - 1;
        let a226 = if f35(f36(v0.clone(), v1, 1u64), Bytes::lit(&[0x5c])) {
            Bytes::lit(&[0x5c, 0x5c])
        } else {
            if f35(f36(v0.clone(), v1, 1u64), v2.clone()) {
                let a222 = Bytes::lit(&[0x5c]);
                let a223 = v2.clone();
                append_bytes(a222, a223)
            } else {
                if f35(f36(v0.clone(), v1, 1u64), Bytes::lit(&[0x0a])) {
                    Bytes::lit(&[0x5c, 0x6e])
                } else {
                    f36(v0.clone(), v1, 1u64)
                }
            }
        };
        let a227 = f47(v0, {
            let a224 = v1;
            let a225 = 1u64;
            nat_add(a224, a225)?
        }, v2, v4)?;
        Ok(append_bytes(a226, a227))
    }
}

pub fn f48(v0: Bytes, v1: Bytes, p230: u64) -> bool {
    let m229 = p230;
    {
        let mut m229 = m229;
        loop {
            let step = {
                let v2 = m229;
                let m228 = v2;
                if m228 == 0 {
                    Err::<u64, bool>(false)
                } else {
                    let v3 = m228 - 1;
                    if f35(f36(v1.clone(), v3, 1u64), v0.clone()) {
                        Err::<u64, bool>(true)
                    } else {
                        Ok::<u64, bool>(v3)
                    }
                }
            };
            match step {
                Ok(next) => { m229 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f49() -> Bytes {
    Bytes::lit(&[0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66])
}

pub fn f50(v0: u64) -> Str {
    f46(f36(f52(), v0, 1u64), Str::lit("0"))
}

pub fn f51(v0: Str, v1: List<Str>, v2: List<Str>) -> bool {
    let a231 = v0.clone();
    let a232 = Str::lit("none");
    if equal(a231, a232) {
        f53(v2)
    } else {
        let a233 = v0.clone();
        let a234 = Str::lit("allow");
        if equal(a233, a234) {
            f54(v2, v1)
        } else {
            let a235 = v0;
            let a236 = Str::lit("exact");
            if equal(a235, a236) {
                if f54(v2.clone(), v1.clone()) {
                    f54(v1, v2)
                } else {
                    false
                }
            } else {
                false
            }
        }
    }
}

pub fn f52() -> Bytes {
    Bytes::lit(&[0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39])
}

pub fn f53(v0: List<Str>) -> bool {
    let m237 = v0;
    match m237.uncons() {
        None => {
            true
        }
        Some((_, _)) => {
            false
        }
    }
}

pub fn f54(p240: List<Str>, v1: List<Str>) -> bool {
    let m239 = p240;
    {
        let mut m239 = m239;
        loop {
            let step = {
                let v0 = m239;
                let m238 = v0;
                match m238.uncons() {
                    None => {
                        Err::<List<Str>, bool>(true)
                    }
                    Some((v2, v3)) => {
                        if f55(v2, v1.clone()) {
                            Ok::<List<Str>, bool>(v3)
                        } else {
                            Err::<List<Str>, bool>(false)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m239 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f55(v0: Str, p245: List<Str>) -> bool {
    let m244 = p245;
    {
        let mut m244 = m244;
        loop {
            let step = {
                let v1 = m244;
                let m241 = v1;
                match m241.uncons() {
                    None => {
                        Err::<List<Str>, bool>(false)
                    }
                    Some((v2, v3)) => {
                        let a242 = v2;
                        let a243 = v0.clone();
                        if equal(a242, a243) {
                            Err::<List<Str>, bool>(true)
                        } else {
                            Ok::<List<Str>, bool>(v3)
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m244 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn run(p0: Adt0) -> R<Adt3> {
    f0(p0)
}
