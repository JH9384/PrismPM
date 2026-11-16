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
    C0(List<(Bytes, Bytes)>, List<Adt1>, Str, List<Str>, Adt4, List<Adt5>),
}

#[derive(Clone)]
pub enum Adt1 {
    C0(Str, Str, bool, Adt2, Str, Adt3),
}

#[derive(Clone)]
pub enum Adt2 {
    C0,
    C1,
    C2,
}

#[derive(Clone)]
pub enum Adt3 {
    C0,
    C1,
    C2,
}

#[derive(Clone)]
pub enum Adt4 {
    C0,
    C1,
    C2,
    C3,
}

#[derive(Clone)]
pub enum Adt5 {
    C0(Str, Str, Str, Str),
}

#[derive(Clone)]
pub enum Adt6 {
    C0(Adt7, Str, Adt9),
}

#[derive(Clone)]
pub enum Adt7 {
    C0(Str, Adt8, Str, Str, List<Str>, List<Str>),
}

#[derive(Clone)]
pub enum Adt8 {
    C0,
    C1,
}

#[derive(Clone)]
pub enum Adt9 {
    C0,
    C1,
    C2,
    C3,
}

#[derive(Clone)]
pub enum Adt10 {
    C0(Str, List<Str>),
}

#[derive(Clone)]
pub enum Adt11 {
    C0(Str, Str, Str, Str, Str, Adt12),
}

#[derive(Clone)]
pub enum Adt12 {
    C0,
    C1,
    C2,
    C3,
    C4,
}

#[derive(Clone)]
pub enum Adt13 {
    C0(u32, u32, u32, u32, u32, u32, u32, u32),
}

#[derive(Clone)]
pub enum Adt14 {
    C0(u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32),
}

#[derive(Clone)]
pub enum Adt15 {
    C0(u32, u32, u32, u32, u32, u32, u32, u32, Adt14, u64),
}

#[derive(Clone)]
pub enum Fn0 {
    F8(List<(Str, bool)>, Adt0, List<Str>),
    F153,
}

impl Fn0 {
    pub fn apply(&self, p0: List<Bytes>, p1: Adt6) -> R<List<Bytes>> {
        match self {
            Fn0::F8(k0, k1, k2) => f8(k0.clone(), k1.clone(), k2.clone(), p0, p1),
            Fn0::F153 => Ok(f153(p0, p1)),
        }
    }
}

#[derive(Clone)]
pub enum Fn1 {
    F13,
}

impl Fn1 {
    pub fn apply(&self, p0: Adt0, p1: Bytes) -> R<Adt0> {
        match self {
            Fn1::F13 => f13(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn2 {
    F17,
}

impl Fn2 {
    pub fn apply(&self, p0: List<Str>, p1: Str) -> List<Str> {
        match self {
            Fn2::F17 => f17(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn3 {
    F20(Adt10),
}

impl Fn3 {
    pub fn apply(&self, p0: List<(Str, bool)>, p1: Adt1) -> List<(Str, bool)> {
        match self {
            Fn3::F20(k0) => f20(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn4 {
    F22(List<(Str, bool)>, List<(Bytes, Bytes)>),
}

impl Fn4 {
    pub fn apply(&self, p0: (List<Adt6>, List<(List<Str>, Str)>), p1: Adt7) -> R<(List<Adt6>, List<(List<Str>, Str)>)> {
        match self {
            Fn4::F22(k0, k1) => f22(k0.clone(), k1.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn5 {
    F24,
    F106,
}

impl Fn5 {
    pub fn apply(&self, p0: List<Adt7>, p1: Adt7) -> List<Adt7> {
        match self {
            Fn5::F24 => f24(p0, p1),
            Fn5::F106 => f106(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn6 {
    F31,
    F152(Str),
}

impl Fn6 {
    pub fn apply(&self, p0: List<Bytes>, p1: Str) -> List<Bytes> {
        match self {
            Fn6::F31 => f31(p0, p1),
            Fn6::F152(k0) => f152(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn7 {
    F33(List<(Str, bool)>, List<Str>),
}

impl Fn7 {
    pub fn apply(&self, p0: Str, p1: Adt6) -> Str {
        match self {
            Fn7::F33(k0, k1) => f33(k0.clone(), k1.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn8 {
    F36(Bytes),
}

impl Fn8 {
    pub fn apply(&self, p0: (u64, (u64, List<Bytes>))) -> R<Option<(u64, (u64, List<Bytes>))>> {
        match self {
            Fn8::F36(k0) => f36(k0.clone(), p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn9 {
    F39,
}

impl Fn9 {
    pub fn apply(&self, p0: List<(Bytes, Bytes)>, p1: (Bytes, Bytes)) -> List<(Bytes, Bytes)> {
        match self {
            Fn9::F39 => f39(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn10 {
    F49,
}

impl Fn10 {
    pub fn apply(&self, p0: List<Bytes>) -> Option<List<Bytes>> {
        match self {
            Fn10::F49 => f49(p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn11 {
    F51,
}

impl Fn11 {
    pub fn apply(&self, p0: List<Bytes>, p1: Bytes) -> List<Bytes> {
        match self {
            Fn11::F51 => f51(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn12 {
    F62(Str),
}

impl Fn12 {
    pub fn apply(&self, p0: List<Bytes>, p1: (Str, Str)) -> List<Bytes> {
        match self {
            Fn12::F62(k0) => f62(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn13 {
    F74,
}

impl Fn13 {
    pub fn apply(&self, p0: List<Str>, p1: Adt7) -> List<Str> {
        match self {
            Fn13::F74 => f74(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn14 {
    F88(Str),
}

impl Fn14 {
    pub fn apply(&self, p0: Adt11, p1: (Str, Adt11)) -> Adt11 {
        match self {
            Fn14::F88(k0) => f88(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn15 {
    F93(Str),
    F115(List<Adt6>),
}

impl Fn15 {
    pub fn apply(&self, p0: bool, p1: Str) -> bool {
        match self {
            Fn15::F93(k0) => f93(k0.clone(), p0, p1),
            Fn15::F115(k0) => f115(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn16 {
    F95(List<Str>, Str),
    F135(List<Str>),
}

impl Fn16 {
    pub fn apply(&self, p0: List<Bytes>, p1: (Bytes, Bytes)) -> R<List<Bytes>> {
        match self {
            Fn16::F95(k0, k1) => f95(k0.clone(), k1.clone(), p0, p1),
            Fn16::F135(k0) => f135(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn17 {
    F100(Str, Str),
}

impl Fn17 {
    pub fn apply(&self, p0: List<(Str, Str)>, p1: Adt5) -> List<(Str, Str)> {
        match self {
            Fn17::F100(k0, k1) => f100(k0.clone(), k1.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn18 {
    F102(Bytes),
}

impl Fn18 {
    pub fn apply(&self, p0: Option<Bytes>, p1: Bytes) -> Option<Bytes> {
        match self {
            Fn18::F102(k0) => f102(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn19 {
    F109(List<Str>),
}

impl Fn19 {
    pub fn apply(&self, p0: Option<Str>, p1: (List<Str>, Str)) -> Option<Str> {
        match self {
            Fn19::F109(k0) => f109(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn20 {
    F113(List<Adt6>),
}

impl Fn20 {
    pub fn apply(&self, p0: List<Adt6>, p1: Str) -> List<Adt6> {
        match self {
            Fn20::F113(k0) => f113(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn21 {
    F117,
}

impl Fn21 {
    pub fn apply(&self, p0: List<Adt9>, p1: Adt6) -> List<Adt9> {
        match self {
            Fn21::F117 => f117(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn22 {
    F121,
}

impl Fn22 {
    pub fn apply(&self, p0: (Option<Bytes>, List<Bytes>), p1: Bytes) -> (Option<Bytes>, List<Bytes>) {
        match self {
            Fn22::F121 => f121(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn23 {
    F124(Str),
}

impl Fn23 {
    pub fn apply(&self, p0: bool, p1: (Str, bool)) -> bool {
        match self {
            Fn23::F124(k0) => f124(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn24 {
    F126(Str, Adt10, Str),
}

impl Fn24 {
    pub fn apply(&self, p0: bool, p1: Adt1) -> bool {
        match self {
            Fn24::F126(k0, k1, k2) => f126(k0.clone(), k1.clone(), k2.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn25 {
    F128(Bytes, u64, Bytes, u64),
}

impl Fn25 {
    pub fn apply(&self, p0: u64) -> R<Option<u64>> {
        match self {
            Fn25::F128(k0, k1, k2, k3) => f128(k0.clone(), *k1, k2.clone(), *k3, p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn26 {
    F141,
}

impl Fn26 {
    pub fn apply(&self, p0: bool, p1: Adt9) -> bool {
        match self {
            Fn26::F141 => f141(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn27 {
    F143(Str),
}

impl Fn27 {
    pub fn apply(&self, p0: Option<bool>, p1: (Str, bool)) -> Option<bool> {
        match self {
            Fn27::F143(k0) => f143(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn28 {
    F148(Bytes, u64, u64),
}

impl Fn28 {
    pub fn apply(&self, p0: (u64, Adt13)) -> R<(u64, Adt13)> {
        match self {
            Fn28::F148(k0, k1, k2) => f148(k0.clone(), *k1, *k2, p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn29 {
    F151(Str),
}

impl Fn29 {
    pub fn apply(&self, p0: Option<Adt6>, p1: Adt6) -> Option<Adt6> {
        match self {
            Fn29::F151(k0) => f151(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn30 {
    F155(bool, Bytes),
}

impl Fn30 {
    pub fn apply(&self, p0: u64, p1: Str) -> R<u64> {
        match self {
            Fn30::F155(k0, k1) => f155(*k0, k1.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn31 {
    F163,
}

impl Fn31 {
    pub fn apply(&self, p0: Adt15) -> R<Adt15> {
        match self {
            Fn31::F163 => f163(p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn32 {
    F181,
}

impl Fn32 {
    pub fn apply(&self, p0: (u64, (u32, u32))) -> (u64, (u32, u32)) {
        match self {
            Fn32::F181 => f181(p0),
        }
    }
}

pub fn f0(v0: Bytes) -> R<Bytes> {
    let v1: Adt0 = f1(v0)?;
    let v2: List<Str> = f2(match v1.clone() {
        Adt0::C0(_, _, _, _, h1, _) => {
            h1
        }
    });
    let v3: List<(Str, bool)> = f3(v1.clone());
    let v4: List<Adt6> = f4(f5(), match v1.clone() {
        Adt0::C0(h2, _, _, _, _, _) => {
            h2
        }
    }, v3.clone())?;
    let a5 = f6(f7(Fn0::F8(v3.clone(), v1, v2.clone()), List::<Bytes>::nil(), v4.clone())?);
    let a6 = {
        let a3 = f9(List::cons(Str::lit("sdk"), List::cons(f10(), List::<Str>::nil())));
        let a4 = f9(List::cons(Str::lit("check"), List::cons(f11(v4, v2, v3), List::<Str>::nil())));
        append_bytes(a3, a4)
    };
    Ok(append_bytes(a5, a6))
}

pub fn f1(v0: Bytes) -> R<Adt0> {
    let v1: Adt0 = f12(Fn1::F13, Adt0::C0(List::<(Bytes, Bytes)>::nil(), List::<Adt1>::nil(), Str::lit(""), List::<Str>::nil(), Adt4::C3, List::<Adt5>::nil()), f14(v0)?)?;
    Ok(Adt0::C0(f15(match v1.clone() {
        Adt0::C0(h7, _, _, _, _, _) => {
            h7
        }
    }), match v1.clone() {
        Adt0::C0(_, h8, _, _, _, _) => {
            h8
        }
    }, match v1.clone() {
        Adt0::C0(_, _, h9, _, _, _) => {
            h9
        }
    }, match v1.clone() {
        Adt0::C0(_, _, _, h10, _, _) => {
            h10
        }
    }, match v1.clone() {
        Adt0::C0(_, _, _, _, h11, _) => {
            h11
        }
    }, match v1 {
        Adt0::C0(_, _, _, _, _, h12) => {
            h12
        }
    }))
}

pub fn f2(v0: Adt4) -> List<Str> {
    f16(Fn2::F17, List::<Str>::nil(), f18(v0))
}

pub fn f3(v0: Adt0) -> List<(Str, bool)> {
    let v1: Adt10 = Adt10::C0(match v0.clone() {
        Adt0::C0(_, _, h13, _, _, _) => {
            h13
        }
    }, match v0.clone() {
        Adt0::C0(_, _, _, h14, _, _) => {
            h14
        }
    });
    f19(Fn3::F20(v1), List::<(Str, bool)>::nil(), match v0 {
        Adt0::C0(_, h15, _, _, _, _) => {
            h15
        }
    })
}

pub fn f4(v0: List<Adt7>, v1: List<(Bytes, Bytes)>, v2: List<(Str, bool)>) -> R<List<Adt6>> {
    let (h16, _) = f21(Fn4::F22(v2, v1), (List::<Adt6>::nil(), List::<(List<Str>, Str)>::nil()), v0)?;
    Ok(h16)
}

pub fn f5() -> List<Adt7> {
    f23(Fn5::F24, List::<Adt7>::nil(), f25())
}

pub fn f6(v0: List<Bytes>) -> Bytes {
    f26(f27(v0))
}

pub fn f7(v0: Fn0, p20: List<Bytes>, p21: List<Adt6>) -> R<List<Bytes>> {
    let m19 = (p20, p21);
    {
        let mut m19 = m19;
        loop {
            let step = {
                let (v1, v2) = m19;
                let m17 = v2;
                match m17.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<Adt6>), R<List<Bytes>>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<Adt6>), R<List<Bytes>>>(({
                            let c18: Fn0 = v0.clone();
                            c18.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m19 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f8(v0: List<(Str, bool)>, v1: Adt0, v2: List<Str>, v3: List<Bytes>, v4: Adt6) -> R<List<Bytes>> {
    Ok(List::cons(f28(v4, v2, v1, v0)?, v3))
}

pub fn f9(v0: List<Str>) -> Bytes {
    f29(f30(Fn6::F31, List::<Bytes>::nil(), v0))
}

pub fn f10() -> Str {
    Str::lit("ghcr.io/uor-foundation/prismpm-sdk@sha256:d6c263a733a6bc36e0458c3f5b9a1f5ea9c14dfbe8c257d3f650a960b5fe633c")
}

pub fn f11(v0: List<Adt6>, v1: List<Str>, v2: List<(Str, bool)>) -> Str {
    f32(Fn7::F33(v2, v1), Str::lit("success"), v0)
}

pub fn f12(v0: Fn1, p25: Adt0, p26: List<Bytes>) -> R<Adt0> {
    let m24 = (p25, p26);
    {
        let mut m24 = m24;
        loop {
            let step = {
                let (v1, v2) = m24;
                let m22 = v2;
                match m22.uncons() {
                    None => {
                        Err::<(Adt0, List<Bytes>), R<Adt0>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(Adt0, List<Bytes>), R<Adt0>>(({
                            let c23: Fn1 = v0.clone();
                            c23.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m24 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f13(v0: Adt0, v1: Bytes) -> R<Adt0> {
    f34(v0, v1)
}

pub fn f14(v0: Bytes) -> R<List<Bytes>> {
    let v1: u64 = {
        let a27 = v0.clone();
        length_bytes(a27)
    };
    let v2: (u64, (u64, List<Bytes>)) = {
        let (h28, _) = f35(Fn8::F36(v0.clone()), v1, (0u64, (0u64, List::<Bytes>::nil())))?;
        h28
    };
    let v3: u64 = {
        let (h29, _) = {
            let (_, h30) = v2.clone();
            h30
        };
        h29
    };
    let v4: List<Bytes> = {
        let (_, h31) = {
            let (_, h32) = v2;
            h32
        };
        h31
    };
    let a33 = v3;
    let a34 = v1;
    if nat_lt(a33, a34) {
        Ok(f27(List::cons(f37(v0, v3, {
            let a35 = v1;
            let a36 = v3;
            nat_sub(a35, a36)
        }), v4)))
    } else {
        Ok(f27(v4))
    }
}

pub fn f15(v0: List<(Bytes, Bytes)>) -> List<(Bytes, Bytes)> {
    f38(Fn9::F39, List::<(Bytes, Bytes)>::nil(), v0)
}

pub fn f16(v0: Fn2, p40: List<Str>, p41: List<Str>) -> List<Str> {
    let m39 = (p40, p41);
    {
        let mut m39 = m39;
        loop {
            let step = {
                let (v1, v2) = m39;
                let m37 = v2;
                match m37.uncons() {
                    None => {
                        Err::<(List<Str>, List<Str>), List<Str>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Str>, List<Str>), List<Str>>(({
                            let c38: Fn2 = v0.clone();
                            c38.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m39 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f17(v0: List<Str>, v1: Str) -> List<Str> {
    if f40(v1.clone()) {
        let a42 = v0;
        let a43 = List::cons(v1, List::<Str>::nil());
        append_list(a42, a43)
    } else {
        v0
    }
}

pub fn f18(v0: Adt4) -> List<Str> {
    let m44 = v0;
    match m44 {
        Adt4::C0 => {
            List::cons(Str::lit("factory-model"), f41(f42()))
        }
        Adt4::C1 => {
            f41(f25())
        }
        Adt4::C2 => {
            f41(f25())
        }
        Adt4::C3 => {
            f41(f25())
        }
    }
}

pub fn f19(v0: Fn3, p48: List<(Str, bool)>, p49: List<Adt1>) -> List<(Str, bool)> {
    let m47 = (p48, p49);
    {
        let mut m47 = m47;
        loop {
            let step = {
                let (v1, v2) = m47;
                let m45 = v2;
                match m45.uncons() {
                    None => {
                        Err::<(List<(Str, bool)>, List<Adt1>), List<(Str, bool)>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<(Str, bool)>, List<Adt1>), List<(Str, bool)>>(({
                            let c46: Fn3 = v0.clone();
                            c46.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m47 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f20(v0: Adt10, v1: List<(Str, bool)>, v2: Adt1) -> List<(Str, bool)> {
    if f43(v2.clone(), v0) {
        List::cons((match v2.clone() {
            Adt1::C0(_, h50, _, _, _, _) => {
                h50
            }
        }, match v2 {
            Adt1::C0(_, _, h51, _, _, _) => {
                h51
            }
        }), v1)
    } else {
        v1
    }
}

pub fn f21(v0: Fn4, p55: (List<Adt6>, List<(List<Str>, Str)>), p56: List<Adt7>) -> R<(List<Adt6>, List<(List<Str>, Str)>)> {
    let m54 = (p55, p56);
    {
        let mut m54 = m54;
        loop {
            let step = {
                let (v1, v2) = m54;
                let m52 = v2;
                match m52.uncons() {
                    None => {
                        Err::<((List<Adt6>, List<(List<Str>, Str)>), List<Adt7>), R<(List<Adt6>, List<(List<Str>, Str)>)>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<((List<Adt6>, List<(List<Str>, Str)>), List<Adt7>), R<(List<Adt6>, List<(List<Str>, Str)>)>>(({
                            let c53: Fn4 = v0.clone();
                            c53.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m54 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f22(v0: List<(Str, bool)>, v1: List<(Bytes, Bytes)>, v2: (List<Adt6>, List<(List<Str>, Str)>), v3: Adt7) -> R<(List<Adt6>, List<(List<Str>, Str)>)> {
    f44(v1, v0, v2, v3)
}

pub fn f23(v0: Fn5, p60: List<Adt7>, p61: List<Adt7>) -> List<Adt7> {
    let m59 = (p60, p61);
    {
        let mut m59 = m59;
        loop {
            let step = {
                let (v1, v2) = m59;
                let m57 = v2;
                match m57.uncons() {
                    None => {
                        Err::<(List<Adt7>, List<Adt7>), List<Adt7>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt7>, List<Adt7>), List<Adt7>>(({
                            let c58: Fn5 = v0.clone();
                            c58.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m59 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f24(v0: List<Adt7>, v1: Adt7) -> List<Adt7> {
    let a62 = v0;
    let a63 = List::cons(f45(v1), List::<Adt7>::nil());
    append_list(a62, a63)
}

pub fn f25() -> List<Adt7> {
    let a66 = {
        let a64 = f46();
        let a65 = f42();
        append_list(a64, a65)
    };
    let a67 = f47();
    append_list(a66, a67)
}

pub fn f26(v0: List<Bytes>) -> Bytes {
    let m70 = {
        let (h68, _) = f48(Fn10::F49, {
            let a69 = v0.clone();
            length_list(a69)
        }, v0);
        h68
    };
    match m70.uncons() {
        None => {
            Bytes::lit(&[])
        }
        Some((v1, _)) => {
            v1
        }
    }
}

pub fn f27(v0: List<Bytes>) -> List<Bytes> {
    f50(Fn11::F51, List::<Bytes>::nil(), v0)
}

pub fn f28(v0: Adt6, v1: List<Str>, v2: Adt0, v3: List<(Str, bool)>) -> R<Bytes> {
    let v4: List<(Bytes, Bytes)> = match v2.clone() {
        Adt0::C0(h71, _, _, _, _, _) => {
            h71
        }
    };
    let v5: Adt7 = match v0.clone() {
        Adt6::C0(h72, _, _) => {
            h72
        }
    };
    let v6: Str = match v5.clone() {
        Adt7::C0(h73, _, _, _, _, _) => {
            h73
        }
    };
    let v7: Adt11 = f52(v6.clone());
    let v8: Bytes = {
        let a81 = {
            let a77 = f9(List::cons(Str::lit("obligation"), List::cons(v6.clone(), List::cons(f53(match v0.clone() {
                Adt6::C0(_, _, h74) => {
                    h74
                }
            }), List::cons(match v0.clone() {
                Adt6::C0(_, h75, _) => {
                    h75
                }
            }, List::<Str>::nil())))));
            let a78 = f9(List::cons(Str::lit("run"), List::cons(v6.clone(), List::cons(match v5.clone() {
                Adt7::C0(_, _, _, h76, _, _) => {
                    h76
                }
            }, List::<Str>::nil()))));
            append_bytes(a77, a78)
        };
        let a82 = f9(List::cons(Str::lit("access"), List::cons(v6.clone(), List::cons(f54(match v7.clone() {
            Adt11::C0(_, _, _, _, _, h79) => {
                h79
            }
        }), List::cons(match v7 {
            Adt11::C0(h80, _, _, _, _, _) => {
                h80
            }
        }, List::<Str>::nil())))));
        append_bytes(a81, a82)
    };
    let v9: Bytes = f29(List::cons(f55(Str::lit("sandbox")), List::cons(f55(v6.clone()), List::cons(f56(v6.clone()), List::<Bytes>::nil()))));
    let v10: bool = if f57(match v0.clone() {
        Adt6::C0(_, _, h83) => {
            h83
        }
    }) {
        f58(v6.clone(), v1.clone())
    } else {
        false
    };
    let v11: Bytes = if v10 {
        let a85 = f9(List::cons(Str::lit("establish"), List::cons(v6.clone(), List::<Str>::nil())));
        let a86 = f59(v6.clone(), match v5 {
            Adt7::C0(_, _, _, _, h84, _) => {
                h84
            }
        }, v4)?;
        append_bytes(a85, a86)
    } else {
        Bytes::lit(&[])
    };
    let v12: Bytes = if f58(v6.clone(), v1) {
        f9(List::cons(Str::lit("status"), List::cons(v6.clone(), List::cons(f60(match v0.clone() {
            Adt6::C0(_, _, h87) => {
                h87
            }
        }, match v0.clone() {
            Adt6::C0(_, h88, _) => {
                h88
            }
        }, v3), List::<Str>::nil()))))
    } else {
        Bytes::lit(&[])
    };
    let v13: Adt10 = Adt10::C0(match v2.clone() {
        Adt0::C0(_, _, h89, _, _, _) => {
            h89
        }
    }, match v2.clone() {
        Adt0::C0(_, _, _, h90, _, _) => {
            h90
        }
    });
    let v14: Bytes = f26(f61(Fn12::F62(v6.clone()), List::<Bytes>::nil(), f63(v6, match v0 {
        Adt6::C0(_, h91, _) => {
            h91
        }
    }, match v2.clone() {
        Adt0::C0(_, h92, _, _, _, _) => {
            h92
        }
    }, match v2 {
        Adt0::C0(_, _, _, _, _, h93) => {
            h93
        }
    }, v13)));
    let a100 = {
        let a98 = {
            let a96 = {
                let a94 = v8;
                let a95 = v9;
                append_bytes(a94, a95)
            };
            let a97 = v11;
            append_bytes(a96, a97)
        };
        let a99 = v12;
        append_bytes(a98, a99)
    };
    let a101 = v14;
    Ok(append_bytes(a100, a101))
}

pub fn f29(v0: List<Bytes>) -> Bytes {
    let a102 = f64(v0, Bytes::lit(&[0x20]));
    let a103 = Bytes::lit(&[0x0a]);
    append_bytes(a102, a103)
}

pub fn f30(v0: Fn6, p107: List<Bytes>, p108: List<Str>) -> List<Bytes> {
    let m106 = (p107, p108);
    {
        let mut m106 = m106;
        loop {
            let step = {
                let (v1, v2) = m106;
                let m104 = v2;
                match m104.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<Str>), List<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<Str>), List<Bytes>>(({
                            let c105: Fn6 = v0.clone();
                            c105.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m106 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f31(v0: List<Bytes>, v1: Str) -> List<Bytes> {
    let a109 = v0;
    let a110 = List::cons(f55(v1), List::<Bytes>::nil());
    append_list(a109, a110)
}

pub fn f32(v0: Fn7, p114: Str, p115: List<Adt6>) -> Str {
    let m113 = (p114, p115);
    {
        let mut m113 = m113;
        loop {
            let step = {
                let (v1, v2) = m113;
                let m111 = v2;
                match m111.uncons() {
                    None => {
                        Err::<(Str, List<Adt6>), Str>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Str, List<Adt6>), Str>(({
                            let c112: Fn7 = v0.clone();
                            c112.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m113 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f33(v0: List<(Str, bool)>, v1: List<Str>, v2: Str, v3: Adt6) -> Str {
    if f58({
        let m118 = match v3.clone() {
            Adt6::C0(h117, _, _) => {
                h117
            }
        };
        match m118 {
            Adt7::C0(h116, _, _, _, _, _) => {
                h116
            }
        }
    }, v1) {
        let v4: Str = f60(match v3.clone() {
            Adt6::C0(_, _, h119) => {
                h119
            }
        }, match v3 {
            Adt6::C0(_, h120, _) => {
                h120
            }
        }, v0);
        let a121 = v2.clone();
        let a122 = Str::lit("failure");
        if equal(a121, a122) {
            v2
        } else {
            let a123 = v4.clone();
            let a124 = Str::lit("failure");
            if equal(a123, a124) {
                v4
            } else {
                let a125 = v2.clone();
                let a126 = Str::lit("success");
                if equal(a125, a126) {
                    v4
                } else {
                    v2
                }
            }
        }
    } else {
        v2
    }
}

pub fn f34(v0: Adt0, v1: Bytes) -> R<Adt0> {
    let v2: (Bytes, Bytes) = f65(v1)?;
    let v3: Bytes = {
        let (h127, _) = v2.clone();
        h127
    };
    let v4: (Bytes, Bytes) = f65({
        let (_, h128) = v2.clone();
        h128
    })?;
    let a129 = v3.clone();
    let a130 = f55(Str::lit("tree"));
    if equal(a129, a130) {
        Ok(Adt0::C0(List::cons(({
            let (h131, _) = v4;
            h131
        }, {
            let (_, h132) = v4;
            h132
        }), match v0.clone() {
            Adt0::C0(h133, _, _, _, _, _) => {
                h133
            }
        }), match v0.clone() {
            Adt0::C0(_, h134, _, _, _, _) => {
                h134
            }
        }, match v0.clone() {
            Adt0::C0(_, _, h135, _, _, _) => {
                h135
            }
        }, match v0.clone() {
            Adt0::C0(_, _, _, h136, _, _) => {
                h136
            }
        }, match v0.clone() {
            Adt0::C0(_, _, _, _, h137, _) => {
                h137
            }
        }, match v0 {
            Adt0::C0(_, _, _, _, _, h138) => {
                h138
            }
        }))
    } else {
        let a139 = v3.clone();
        let a140 = f55(Str::lit("signed"));
        if equal(a139, a140) {
            Ok(Adt0::C0(match v0.clone() {
                Adt0::C0(h141, _, _, _, _, _) => {
                    h141
                }
            }, {
                let v5: (Bytes, Bytes) = f65({
                    let (_, h142) = v4;
                    h142
                })?;
                let v6: (Bytes, Bytes) = f65({
                    let (_, h143) = v5;
                    h143
                })?;
                let v7: (Bytes, Bytes) = f65({
                    let (_, h144) = v6;
                    h144
                })?;
                let v8: (Bytes, Bytes) = f65({
                    let (_, h145) = v7;
                    h145
                })?;
                List::cons(Adt1::C0(f66({
                    let (h146, _) = v4;
                    h146
                }), f66({
                    let (h147, _) = v5;
                    h147
                }), f67({
                    let (h148, _) = v6;
                    h148
                }), f68({
                    let (h149, _) = v7;
                    h149
                }), f66({
                    let (_, h150) = v8;
                    h150
                }), f69({
                    let (h151, _) = v8;
                    h151
                })), match v0.clone() {
                    Adt0::C0(_, h152, _, _, _, _) => {
                        h152
                    }
                })
            }, match v0.clone() {
                Adt0::C0(_, _, h153, _, _, _) => {
                    h153
                }
            }, match v0.clone() {
                Adt0::C0(_, _, _, h154, _, _) => {
                    h154
                }
            }, match v0.clone() {
                Adt0::C0(_, _, _, _, h155, _) => {
                    h155
                }
            }, match v0 {
                Adt0::C0(_, _, _, _, _, h156) => {
                    h156
                }
            }))
        } else {
            let a157 = v3.clone();
            let a158 = f55(Str::lit("trust-repository"));
            if equal(a157, a158) {
                Ok(Adt0::C0(match v0.clone() {
                    Adt0::C0(h159, _, _, _, _, _) => {
                        h159
                    }
                }, match v0.clone() {
                    Adt0::C0(_, h160, _, _, _, _) => {
                        h160
                    }
                }, f66({
                    let (_, h161) = v2;
                    h161
                }), match v0.clone() {
                    Adt0::C0(_, _, _, h162, _, _) => {
                        h162
                    }
                }, match v0.clone() {
                    Adt0::C0(_, _, _, _, h163, _) => {
                        h163
                    }
                }, match v0 {
                    Adt0::C0(_, _, _, _, _, h164) => {
                        h164
                    }
                }))
            } else {
                let a165 = v3.clone();
                let a166 = f55(Str::lit("trust-maintainer"));
                if equal(a165, a166) {
                    Ok(Adt0::C0(match v0.clone() {
                        Adt0::C0(h167, _, _, _, _, _) => {
                            h167
                        }
                    }, match v0.clone() {
                        Adt0::C0(_, h168, _, _, _, _) => {
                            h168
                        }
                    }, match v0.clone() {
                        Adt0::C0(_, _, h169, _, _, _) => {
                            h169
                        }
                    }, List::cons(f66({
                        let (_, h170) = v2;
                        h170
                    }), match v0.clone() {
                        Adt0::C0(_, _, _, h171, _, _) => {
                            h171
                        }
                    }), match v0.clone() {
                        Adt0::C0(_, _, _, _, h172, _) => {
                            h172
                        }
                    }, match v0 {
                        Adt0::C0(_, _, _, _, _, h173) => {
                            h173
                        }
                    }))
                } else {
                    let a174 = v3.clone();
                    let a175 = f55(Str::lit("event"));
                    if equal(a174, a175) {
                        Ok(Adt0::C0(match v0.clone() {
                            Adt0::C0(h176, _, _, _, _, _) => {
                                h176
                            }
                        }, match v0.clone() {
                            Adt0::C0(_, h177, _, _, _, _) => {
                                h177
                            }
                        }, match v0.clone() {
                            Adt0::C0(_, _, h178, _, _, _) => {
                                h178
                            }
                        }, match v0.clone() {
                            Adt0::C0(_, _, _, h179, _, _) => {
                                h179
                            }
                        }, f70({
                            let (_, h180) = v2;
                            h180
                        }), match v0 {
                            Adt0::C0(_, _, _, _, _, h181) => {
                                h181
                            }
                        }))
                    } else {
                        let a182 = v3;
                        let a183 = f55(Str::lit("output"));
                        if equal(a182, a183) {
                            Ok(Adt0::C0(match v0.clone() {
                                Adt0::C0(h184, _, _, _, _, _) => {
                                    h184
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, h185, _, _, _, _) => {
                                    h185
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, h186, _, _, _) => {
                                    h186
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, _, h187, _, _) => {
                                    h187
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, _, _, h188, _) => {
                                    h188
                                }
                            }, {
                                let v9: (Bytes, Bytes) = f65({
                                    let (_, h189) = v4;
                                    h189
                                })?;
                                let v10: (Bytes, Bytes) = f65({
                                    let (_, h190) = v9;
                                    h190
                                })?;
                                List::cons(Adt5::C0(f66({
                                    let (h191, _) = v4;
                                    h191
                                }), f66({
                                    let (h192, _) = v9;
                                    h192
                                }), f66({
                                    let (h193, _) = v10;
                                    h193
                                }), f66({
                                    let (_, h194) = v10;
                                    h194
                                })), match v0 {
                                    Adt0::C0(_, _, _, _, _, h195) => {
                                        h195
                                    }
                                })
                            }))
                        } else {
                            Ok(v0)
                        }
                    }
                }
            }
        }
    }
}

pub fn f35(v0: Fn8, p200: u64, p201: (u64, (u64, List<Bytes>))) -> R<((u64, (u64, List<Bytes>)), bool)> {
    let m199 = (p200, p201);
    {
        let mut m199 = m199;
        loop {
            let step = {
                let (v1, v2) = m199;
                let m196 = v1;
                if m196 == 0 {
                    Err::<(u64, (u64, (u64, List<Bytes>))), R<((u64, (u64, List<Bytes>)), bool)>>(Ok((v2, false)))
                } else {
                    let v3 = m196 - 1;
                    let m198 = {
                        let c197: Fn8 = v0.clone();
                        c197.apply(v2.clone())?
                    };
                    match m198 {
                        None => {
                            Err::<(u64, (u64, (u64, List<Bytes>))), R<((u64, (u64, List<Bytes>)), bool)>>(Ok((v2, true)))
                        }
                        Some(v4) => {
                            Ok::<(u64, (u64, (u64, List<Bytes>))), R<((u64, (u64, List<Bytes>)), bool)>>((v3, v4))
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m199 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f36(v0: Bytes, v1: (u64, (u64, List<Bytes>))) -> R<Option<(u64, (u64, List<Bytes>))>> {
    f71(v0, v1)
}

pub fn f37(v0: Bytes, v1: u64, v2: u64) -> Bytes {
    let m205 = {
        let a202 = v0;
        let a203 = v1;
        let a204 = v2;
        slice_bytes(a202, a203, a204)
    };
    match m205 {
        None => {
            Bytes::lit(&[])
        }
        Some(v3) => {
            v3
        }
    }
}

pub fn f38(v0: Fn9, p209: List<(Bytes, Bytes)>, p210: List<(Bytes, Bytes)>) -> List<(Bytes, Bytes)> {
    let m208 = (p209, p210);
    {
        let mut m208 = m208;
        loop {
            let step = {
                let (v1, v2) = m208;
                let m206 = v2;
                match m206.uncons() {
                    None => {
                        Err::<(List<(Bytes, Bytes)>, List<(Bytes, Bytes)>), List<(Bytes, Bytes)>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<(Bytes, Bytes)>, List<(Bytes, Bytes)>), List<(Bytes, Bytes)>>(({
                            let c207: Fn9 = v0.clone();
                            c207.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m208 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f39(v0: List<(Bytes, Bytes)>, v1: (Bytes, Bytes)) -> List<(Bytes, Bytes)> {
    List::cons(v1, v0)
}

pub fn f40(v0: Str) -> bool {
    f58(v0, f72())
}

pub fn f41(v0: List<Adt7>) -> List<Str> {
    f73(Fn13::F74, List::<Str>::nil(), v0)
}

pub fn f42() -> List<Adt7> {
    f75(f76())
}

pub fn f43(v0: Adt1, v1: Adt10) -> bool {
    let m212 = match v0.clone() {
        Adt1::C0(_, _, _, h211, _, _) => {
            h211
        }
    };
    match m212 {
        Adt2::C0 => {
            let a215 = match v0 {
                Adt1::C0(_, _, _, _, h213, _) => {
                    h213
                }
            };
            let a216 = match v1 {
                Adt10::C0(h214, _) => {
                    h214
                }
            };
            equal(a215, a216)
        }
        Adt2::C1 => {
            f58(match v0 {
                Adt1::C0(_, _, _, _, h217, _) => {
                    h217
                }
            }, match v1 {
                Adt10::C0(_, h218) => {
                    h218
                }
            })
        }
        Adt2::C2 => {
            false
        }
    }
}

pub fn f44(v0: List<(Bytes, Bytes)>, v1: List<(Str, bool)>, v2: (List<Adt6>, List<(List<Str>, Str)>), v3: Adt7) -> R<(List<Adt6>, List<(List<Str>, Str)>)> {
    let v4: List<Adt6> = {
        let (h219, _) = v2;
        h219
    };
    let v5: List<(List<Str>, Str)> = {
        let (_, h220) = v2;
        h220
    };
    let v6: List<Str> = match v3.clone() {
        Adt7::C0(_, _, _, _, h221, _) => {
            h221
        }
    };
    let v8: Str = {
        let m222 = f77(v6.clone(), v5.clone());
        match m222 {
            None => {
                f78(v6.clone(), v0)?
            }
            Some(v7) => {
                v7
            }
        }
    };
    let v9: List<Adt6> = f79(match v3.clone() {
        Adt7::C0(_, _, _, _, _, h223) => {
            h223
        }
    }, v4.clone());
    let v10: Str = f80(v3.clone(), v8.clone(), v9.clone())?;
    let v11: List<Adt9> = if f81(match v3.clone() {
        Adt7::C0(_, _, _, _, _, h224) => {
            h224
        }
    }, v4.clone()) {
        f82(v9)
    } else {
        List::cons(Adt9::C3, List::<Adt9>::nil())
    };
    Ok(({
        let a226 = v4;
        let a227 = List::cons(Adt6::C0(v3.clone(), v10.clone(), f83(match v3 {
            Adt7::C0(_, h225, _, _, _, _) => {
                h225
            }
        }, v10, v1, v11)), List::<Adt6>::nil());
        append_list(a226, a227)
    }, List::cons((v6, v8), v5)))
}

pub fn f45(v0: Adt7) -> Adt7 {
    Adt7::C0(match v0.clone() {
        Adt7::C0(h228, _, _, _, _, _) => {
            h228
        }
    }, match v0.clone() {
        Adt7::C0(_, h229, _, _, _, _) => {
            h229
        }
    }, f66(f56(match v0.clone() {
        Adt7::C0(h230, _, _, _, _, _) => {
            h230
        }
    })), match v0.clone() {
        Adt7::C0(_, _, _, h231, _, _) => {
            h231
        }
    }, match v0.clone() {
        Adt7::C0(_, _, _, _, h232, _) => {
            h232
        }
    }, match v0 {
        Adt7::C0(_, _, _, _, _, h233) => {
            h233
        }
    })
}

pub fn f46() -> List<Adt7> {
    f75(f84())
}

pub fn f47() -> List<Adt7> {
    f75(f85())
}

pub fn f48(v0: Fn10, p238: u64, p239: List<Bytes>) -> (List<Bytes>, bool) {
    let m237 = (p238, p239);
    {
        let mut m237 = m237;
        loop {
            let step = {
                let (v1, v2) = m237;
                let m234 = v1;
                if m234 == 0 {
                    Err::<(u64, List<Bytes>), (List<Bytes>, bool)>((v2, false))
                } else {
                    let v3 = m234 - 1;
                    let m236 = {
                        let c235: Fn10 = v0.clone();
                        c235.apply(v2.clone())
                    };
                    match m236 {
                        None => {
                            Err::<(u64, List<Bytes>), (List<Bytes>, bool)>((v2, true))
                        }
                        Some(v4) => {
                            Ok::<(u64, List<Bytes>), (List<Bytes>, bool)>((v3, v4))
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m237 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f49(v0: List<Bytes>) -> Option<List<Bytes>> {
    f86(v0)
}

pub fn f50(v0: Fn11, p243: List<Bytes>, p244: List<Bytes>) -> List<Bytes> {
    let m242 = (p243, p244);
    {
        let mut m242 = m242;
        loop {
            let step = {
                let (v1, v2) = m242;
                let m240 = v2;
                match m240.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<Bytes>), List<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<Bytes>), List<Bytes>>(({
                            let c241: Fn11 = v0.clone();
                            c241.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m242 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f51(v0: List<Bytes>, v1: Bytes) -> List<Bytes> {
    List::cons(v1, v0)
}

pub fn f52(v0: Str) -> Adt11 {
    f87(Fn14::F88(v0), f89(Str::lit("@sdk"), Adt12::C0), f90())
}

pub fn f53(v0: Adt9) -> Str {
    let m245 = v0;
    match m245 {
        Adt9::C0 => {
            Str::lit("proved")
        }
        Adt9::C1 => {
            Str::lit("observe")
        }
        Adt9::C2 => {
            Str::lit("refuted")
        }
        Adt9::C3 => {
            Str::lit("blocked")
        }
    }
}

pub fn f54(v0: Adt12) -> Str {
    let m246 = v0;
    match m246 {
        Adt12::C0 => {
            Str::lit("sealed")
        }
        Adt12::C1 => {
            Str::lit("pinned")
        }
        Adt12::C2 => {
            Str::lit("daemon")
        }
        Adt12::C3 => {
            Str::lit("publish")
        }
        Adt12::C4 => {
            Str::lit("live")
        }
    }
}

pub fn f55(v0: Str) -> Bytes {
    let a247 = v0;
    utf8_encode(a247)
}

pub fn f56(v0: Str) -> Bytes {
    let v1: Adt11 = f52(v0);
    f64(List::cons({
        let a248 = Str::lit("prism/1");
        utf8_encode(a248)
    }, List::cons({
        let a249 = f91(v1.clone());
        utf8_encode(a249)
    }, List::cons({
        let a251 = match v1.clone() {
            Adt11::C0(_, h250, _, _, _, _) => {
                h250
            }
        };
        utf8_encode(a251)
    }, List::cons({
        let a253 = match v1.clone() {
            Adt11::C0(_, _, h252, _, _, _) => {
                h252
            }
        };
        utf8_encode(a253)
    }, List::cons({
        let a255 = match v1.clone() {
            Adt11::C0(_, _, _, h254, _, _) => {
                h254
            }
        };
        utf8_encode(a255)
    }, List::cons({
        let a257 = match v1.clone() {
            Adt11::C0(_, _, _, _, h256, _) => {
                h256
            }
        };
        utf8_encode(a257)
    }, List::cons({
        let a259 = f54(match v1 {
            Adt11::C0(_, _, _, _, _, h258) => {
                h258
            }
        });
        utf8_encode(a259)
    }, List::<Bytes>::nil()))))))), Bytes::lit(&[0x20]))
}

pub fn f57(v0: Adt9) -> bool {
    let m260 = v0;
    match m260 {
        Adt9::C0 => {
            false
        }
        Adt9::C1 => {
            true
        }
        Adt9::C2 => {
            false
        }
        Adt9::C3 => {
            false
        }
    }
}

pub fn f58(v0: Str, v1: List<Str>) -> bool {
    f92(Fn15::F93(v0), false, v1)
}

pub fn f59(v0: Str, v1: List<Str>, v2: List<(Bytes, Bytes)>) -> R<Bytes> {
    Ok(f6(f94(Fn16::F95(v1, v0), List::<Bytes>::nil(), v2)?))
}

pub fn f60(v0: Adt9, v1: Str, v2: List<(Str, bool)>) -> Str {
    if f96(v0.clone()) {
        Str::lit("success")
    } else {
        let a261 = f53(v0);
        let a262 = Str::lit("refuted");
        if if equal(a261, a262) {
            true
        } else {
            f97(v1, v2)
        } {
            Str::lit("failure")
        } else {
            Str::lit("pending")
        }
    }
}

pub fn f61(v0: Fn12, p266: List<Bytes>, p267: List<(Str, Str)>) -> List<Bytes> {
    let m265 = (p266, p267);
    {
        let mut m265 = m265;
        loop {
            let step = {
                let (v1, v2) = m265;
                let m263 = v2;
                match m263.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<(Str, Str)>), List<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<(Str, Str)>), List<Bytes>>(({
                            let c264: Fn12 = v0.clone();
                            c264.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m265 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f62(v0: Str, v1: List<Bytes>, v2: (Str, Str)) -> List<Bytes> {
    let a270 = v1;
    let a271 = List::cons(f9(List::cons(Str::lit("output"), List::cons(v0, List::cons({
        let (h268, _) = v2;
        h268
    }, List::cons({
        let (_, h269) = v2;
        h269
    }, List::<Str>::nil()))))), List::<Bytes>::nil());
    append_list(a270, a271)
}

pub fn f63(v0: Str, v1: Str, v2: List<Adt1>, v3: List<Adt5>, v4: Adt10) -> List<(Str, Str)> {
    if f98(v0.clone(), v1.clone(), v2, v4) {
        f99(Fn17::F100(v1, v0), List::<(Str, Str)>::nil(), v3)
    } else {
        List::<(Str, Str)>::nil()
    }
}

pub fn f64(v0: List<Bytes>, v1: Bytes) -> Bytes {
    let m272 = f101(Fn18::F102(v1), None::<Bytes>, v0);
    match m272 {
        None => {
            Bytes::lit(&[])
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f65(v0: Bytes) -> R<(Bytes, Bytes)> {
    let m273 = f103(v0.clone(), Bytes::lit(&[0x20]))?;
    match m273 {
        None => {
            Ok((v0, Bytes::lit(&[])))
        }
        Some(v1) => {
            Ok((f37(v0.clone(), 0u64, v1), f37(v0.clone(), {
                let a274 = v1;
                let a275 = 1u64;
                nat_add(a274, a275)?
            }, {
                let a279 = {
                    let a276 = v0;
                    length_bytes(a276)
                };
                let a280 = {
                    let a277 = v1;
                    let a278 = 1u64;
                    nat_add(a277, a278)?
                };
                nat_sub(a279, a280)
            })))
        }
    }
}

pub fn f66(v0: Bytes) -> Str {
    let m282 = {
        let a281 = v0;
        utf8_decode(a281)
    };
    match m282 {
        None => {
            Str::lit("")
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f67(v0: Bytes) -> bool {
    let a283 = v0;
    let a284 = f55(Str::lit("pass"));
    equal(a283, a284)
}

pub fn f68(v0: Bytes) -> Adt2 {
    let a285 = v0.clone();
    let a286 = f55(Str::lit("workflow"));
    if equal(a285, a286) {
        Adt2::C0
    } else {
        let a287 = v0;
        let a288 = f55(Str::lit("maintainer"));
        if equal(a287, a288) {
            Adt2::C1
        } else {
            Adt2::C2
        }
    }
}

pub fn f69(v0: Bytes) -> Adt3 {
    let a289 = v0.clone();
    let a290 = f55(Str::lit("workstation"));
    if equal(a289, a290) {
        Adt3::C1
    } else {
        let a291 = v0;
        let a292 = f55(Str::lit("browser"));
        if equal(a291, a292) {
            Adt3::C2
        } else {
            Adt3::C0
        }
    }
}

pub fn f70(v0: Bytes) -> Adt4 {
    let a293 = v0.clone();
    let a294 = f55(Str::lit("pull_request"));
    if equal(a293, a294) {
        Adt4::C0
    } else {
        let a295 = v0.clone();
        let a296 = f55(Str::lit("push"));
        if equal(a295, a296) {
            Adt4::C1
        } else {
            let a297 = v0;
            let a298 = f55(Str::lit("tag"));
            if equal(a297, a298) {
                Adt4::C2
            } else {
                Adt4::C3
            }
        }
    }
}

pub fn f71(v0: Bytes, v1: (u64, (u64, List<Bytes>))) -> R<Option<(u64, (u64, List<Bytes>))>> {
    let v2: u64 = {
        let (h299, _) = v1.clone();
        h299
    };
    let v3: u64 = {
        let (h300, _) = {
            let (_, h301) = v1.clone();
            h301
        };
        h300
    };
    let v4: List<Bytes> = {
        let (_, h302) = {
            let (_, h303) = v1;
            h303
        };
        h302
    };
    let m304 = f104(v0.clone(), v2);
    match m304 {
        None => {
            Ok(None::<(u64, (u64, List<Bytes>))>)
        }
        Some(v5) => {
            let a305 = v5;
            let a306 = 10u8;
            if equal(a305, a306) {
                Ok(Some(({
                    let a307 = v2;
                    let a308 = 1u64;
                    nat_add(a307, a308)?
                }, ({
                    let a309 = v2;
                    let a310 = 1u64;
                    nat_add(a309, a310)?
                }, List::cons(f105(f37(v0, v3, {
                    let a311 = v2;
                    let a312 = v3;
                    nat_sub(a311, a312)
                })), v4)))))
            } else {
                Ok(Some(({
                    let a313 = v2;
                    let a314 = 1u64;
                    nat_add(a313, a314)?
                }, (v3, v4))))
            }
        }
    }
}

pub fn f72() -> List<Str> {
    List::cons(Str::lit("factory-model"), List::cons(Str::lit("vv-sdk"), List::cons(Str::lit("lint"), List::cons(Str::lit("model-audits"), List::cons(Str::lit("fixtures-golden"), List::cons(Str::lit("devcontainer"), List::<Str>::nil()))))))
}

pub fn f73(v0: Fn13, p318: List<Str>, p319: List<Adt7>) -> List<Str> {
    let m317 = (p318, p319);
    {
        let mut m317 = m317;
        loop {
            let step = {
                let (v1, v2) = m317;
                let m315 = v2;
                match m315.uncons() {
                    None => {
                        Err::<(List<Str>, List<Adt7>), List<Str>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Str>, List<Adt7>), List<Str>>(({
                            let c316: Fn13 = v0.clone();
                            c316.apply(v1, v3)
                        }, v4))
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

pub fn f74(v0: List<Str>, v1: Adt7) -> List<Str> {
    let a321 = v0;
    let a322 = List::cons(match v1 {
        Adt7::C0(h320, _, _, _, _, _) => {
            h320
        }
    }, List::<Str>::nil());
    append_list(a321, a322)
}

pub fn f75(v0: List<Adt7>) -> List<Adt7> {
    f23(Fn5::F106, List::<Adt7>::nil(), v0)
}

pub fn f76() -> List<Adt7> {
    List::cons(f107(Str::lit("lint"), Adt8::C1, Str::lit("prism"), Str::lit("cargo fetch --locked && cargo fmt --check && cargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings && cargo deny fetch && cargo deny --frozen --all-features check"), List::cons(Str::lit(""), List::<Str>::nil()), List::<Str>::nil()), List::cons(f107(Str::lit("model-audits"), Adt8::C1, Str::lit("prism"), Str::lit("bash scripts/fetch.sh && cargo xtask validate"), List::cons(Str::lit(""), List::cons(Str::lit("@base:model/modules.toml"), List::<Str>::nil())), List::<Str>::nil()), List::cons(f107(Str::lit("fixtures-golden"), Adt8::C1, Str::lit("prism"), Str::lit("cargo fetch --locked && bash scripts/fetch-oracle-cargo.sh && cargo xtask check-fixtures && cargo run --locked --offline --manifest-path tests/holo-codec-oracle/Cargo.toml --target-dir target/holo-codec-oracle && cargo xtask check-golden"), List::cons(Str::lit(""), List::<Str>::nil()), List::<Str>::nil()), List::<Adt7>::nil())))
}

pub fn f77(v0: List<Str>, v1: List<(List<Str>, Str)>) -> Option<Str> {
    f108(Fn19::F109(v0), None::<Str>, v1)
}

pub fn f78(v0: List<Str>, v1: List<(Bytes, Bytes)>) -> R<Str> {
    Ok(f66(f110(f111(v0, v1)?)?))
}

pub fn f79(v0: List<Str>, v1: List<Adt6>) -> List<Adt6> {
    f112(Fn20::F113(v1), List::<Adt6>::nil(), v0)
}

pub fn f80(v0: Adt7, v1: Str, v2: List<Adt6>) -> R<Str> {
    Ok(f66(f110(f114(v0, v1, v2)?)?))
}

pub fn f81(v0: List<Str>, v1: List<Adt6>) -> bool {
    f92(Fn15::F115(v1), true, v0)
}

pub fn f82(v0: List<Adt6>) -> List<Adt9> {
    f116(Fn21::F117, List::<Adt9>::nil(), v0)
}

pub fn f83(v0: Adt8, v1: Str, v2: List<(Str, bool)>, v3: List<Adt9>) -> Adt9 {
    if f118(v3) {
        let m323 = f119(v1, v2);
        match m323 {
            None => {
                Adt9::C1
            }
            Some(v4) => {
                if v4 {
                    Adt9::C0
                } else {
                    let m324 = v0;
                    match m324 {
                        Adt8::C0 => {
                            Adt9::C2
                        }
                        Adt8::C1 => {
                            Adt9::C1
                        }
                    }
                }
            }
        }
    } else {
        Adt9::C3
    }
}

pub fn f84() -> List<Adt7> {
    List::cons(f107(Str::lit("policy"), Adt8::C0, Str::lit("actions"), Str::lit("release.yml/policy"), List::cons(Str::lit(".github/workflows/release.yml"), List::cons(Str::lit("Cargo.toml"), List::cons(Str::lit("model/errors.toml"), List::cons(Str::lit("scripts/"), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil())))))), List::<Str>::nil()), List::cons(f107(Str::lit("factory-model"), Adt8::C0, Str::lit("host"), Str::lit("bash prism-factory/check.sh"), List::cons(Str::lit(".github/workflows/factory.yml"), List::cons(Str::lit(".github/workflows/prism-delegation.yml"), List::cons(Str::lit(".github/workflows/release-cut.yml"), List::cons(Str::lit(".github/workflows/release.yml"), List::cons(Str::lit("prism-factory/"), List::cons(Str::lit("vendor/lexlean/"), List::<Str>::nil())))))), List::<Str>::nil()), List::cons(f107(Str::lit("plumbing"), Adt8::C0, Str::lit("actions"), Str::lit("release.yml/devcontainer-image"), List::cons(Str::lit(""), List::cons(Str::lit("@run"), List::<Str>::nil())), List::cons(Str::lit("policy"), List::<Str>::nil())), List::cons(f107(Str::lit("vv-sdk"), Adt8::C1, Str::lit("actions"), Str::lit("bash prism-factory/obligations/vv-sdk.sh"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.mjs"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/release-rebuild.sh"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-candidate-sbom.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/vv-sdk.yml"), List::cons(Str::lit("prism-factory/obligations/image.sh"), List::cons(Str::lit("prism-factory/obligations/vv-sdk.sh"), List::<Str>::nil())))))))))))))))))))))))))))))))))), List::<Str>::nil()), List::cons(f107(Str::lit("source-vv"), Adt8::C1, Str::lit("actions"), Str::lit("release.yml/source-vv"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.mjs"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/release-rebuild.sh"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-candidate-sbom.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/source-vv.yml"), List::<Str>::nil())))))))))))))))))))))))))))))))), List::cons(Str::lit("vv-sdk"), List::<Str>::nil())), List::cons(f107(Str::lit("build"), Adt8::C1, Str::lit("actions"), Str::lit("release.yml/build"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-candidate-sbom.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("scripts/release-gate-evidence.mjs"), List::cons(Str::lit("scripts/release-phases.mjs"), List::cons(Str::lit("scripts/release-rebuild.sh"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/image-platforms.yml"), List::cons(Str::lit("prism-factory/jobs/images.yml"), List::cons(Str::lit("prism-factory/jobs/reproducibility.yml"), List::cons(Str::lit("prism-factory/jobs/native.yml"), List::cons(Str::lit("prism-factory/jobs/installed-sdk.yml"), List::<Str>::nil())))))))))))))))))))))))))))))))))))), List::<Str>::nil()), List::cons(f107(Str::lit("gate"), Adt8::C0, Str::lit("actions"), Str::lit("release.yml/gate"), List::cons(Str::lit(""), List::cons(Str::lit("@run"), List::<Str>::nil())), List::cons(Str::lit("plumbing"), List::cons(Str::lit("source-vv"), List::<Str>::nil()))), List::cons(f107(Str::lit("oci-native"), Adt8::C1, Str::lit("actions"), Str::lit("release.yml/oci-native"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("gate"), List::cons(Str::lit("build"), List::<Str>::nil()))), List::cons(f107(Str::lit("crates"), Adt8::C1, Str::lit("actions"), Str::lit("release.yml/crates"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("oci-native"), List::<Str>::nil())), List::cons(f107(Str::lit("release"), Adt8::C1, Str::lit("actions"), Str::lit("release.yml/release"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("factory-model"), List::cons(Str::lit("crates"), List::<Str>::nil()))), List::<Adt7>::nil()))))))))))
}

pub fn f85() -> List<Adt7> {
    List::cons(f107(Str::lit("devcontainer"), Adt8::C1, Str::lit("prism"), Str::lit("bash prism-factory/obligations/devcontainer.sh"), List::cons(Str::lit(".devcontainer/"), List::cons(Str::lit("prism-factory/obligations/devcontainer.sh"), List::cons(Str::lit("prism-factory/obligations/image.sh"), List::cons(Str::lit("scripts/browser-environment-preflight.mjs"), List::cons(Str::lit("scripts/browser-environment-preflight.sh"), List::cons(Str::lit("sdk/bootstrap/"), List::cons(Str::lit("sdk/browser-engine/"), List::cons(Str::lit("sdk/browser/browser-test-server.mjs"), List::cons(Str::lit("sdk/oracles/go/cloudevents-validator/"), List::cons(Str::lit("sdk/oracles/openid-conformance.sh"), List::cons(Str::lit("sdk/oracles/package-lock.json"), List::cons(Str::lit("sdk/oracles/package.json"), List::cons(Str::lit("standards/oracles/cloudevents-sdk-go-2.16.2/"), List::cons(Str::lit("standards/oracles/oci-distribution-1.1.1/"), List::cons(Str::lit("standards/oracles/oci-image-1.1.1/"), List::cons(Str::lit("standards/oracles/oci-runtime-1.3.0/"), List::cons(Str::lit("standards/oracles/openid-conformance-suite-3e09b13b/"), List::<Str>::nil()))))))))))))))))), List::<Str>::nil()), List::<Adt7>::nil())
}

pub fn f86(v0: List<Bytes>) -> Option<List<Bytes>> {
    let m325 = v0.clone();
    match m325.uncons() {
        None => {
            None::<List<Bytes>>
        }
        Some((_, v2)) => {
            let m326 = v2;
            match m326.uncons() {
                None => {
                    None::<List<Bytes>>
                }
                Some((_, _)) => {
                    let v5: (Option<Bytes>, List<Bytes>) = f120(Fn22::F121, (None::<Bytes>, List::<Bytes>::nil()), v0);
                    let m328 = {
                        let (h327, _) = v5;
                        h327
                    };
                    match m328 {
                        None => {
                            Some(f27({
                                let (_, h330) = v5;
                                h330
                            }))
                        }
                        Some(v6) => {
                            Some(f27(List::cons(v6, {
                                let (_, h329) = v5;
                                h329
                            })))
                        }
                    }
                }
            }
        }
    }
}

pub fn f87(v0: Fn14, p334: Adt11, p335: List<(Str, Adt11)>) -> Adt11 {
    let m333 = (p334, p335);
    {
        let mut m333 = m333;
        loop {
            let step = {
                let (v1, v2) = m333;
                let m331 = v2;
                match m331.uncons() {
                    None => {
                        Err::<(Adt11, List<(Str, Adt11)>), Adt11>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Adt11, List<(Str, Adt11)>), Adt11>(({
                            let c332: Fn14 = v0.clone();
                            c332.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m333 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f88(v0: Str, v1: Adt11, v2: (Str, Adt11)) -> Adt11 {
    let a337 = {
        let (h336, _) = v2;
        h336
    };
    let a338 = v0;
    if equal(a337, a338) {
        let (_, h339) = v2;
        h339
    } else {
        v1
    }
}

pub fn f89(v0: Str, v1: Adt12) -> Adt11 {
    Adt11::C0(v0, Str::lit("1000:1000"), Str::lit("0022"), Str::lit("tmp/prismpm-home"), Str::lit("tmp"), v1)
}

pub fn f90() -> List<(Str, Adt11)> {
    List::cons((Str::lit("policy"), f89(Str::lit("@sdk"), Adt12::C0)), List::cons((Str::lit("factory-model"), f89(Str::lit("@sdk"), Adt12::C1)), List::cons((Str::lit("plumbing"), f89(Str::lit("@sdk"), Adt12::C1)), List::cons((Str::lit("vv-sdk"), f89(Str::lit("@sdk"), Adt12::C3)), List::cons((Str::lit("source-vv"), f89(Str::lit("@vv-sdk"), Adt12::C0)), List::cons((Str::lit("build"), f89(Str::lit("@sdk"), Adt12::C1)), List::cons((Str::lit("gate"), f89(Str::lit("@vv-sdk"), Adt12::C0)), List::cons((Str::lit("oci-native"), f89(Str::lit("@build"), Adt12::C1)), List::cons((Str::lit("crates"), f89(Str::lit("@build"), Adt12::C1)), List::cons((Str::lit("release"), f89(Str::lit("@build"), Adt12::C1)), List::cons((Str::lit("lint"), f89(Str::lit("@sdk"), Adt12::C1)), List::cons((Str::lit("model-audits"), f89(Str::lit("@sdk"), Adt12::C2)), List::cons((Str::lit("fixtures-golden"), f89(Str::lit("@sdk"), Adt12::C1)), List::cons((Str::lit("devcontainer"), f89(Str::lit("@sdk"), Adt12::C3)), List::<(Str, Adt11)>::nil()))))))))))))))
}

pub fn f91(v0: Adt11) -> Str {
    let a341 = match v0.clone() {
        Adt11::C0(h340, _, _, _, _, _) => {
            h340
        }
    };
    let a342 = Str::lit("@sdk");
    if equal(a341, a342) {
        f10()
    } else {
        match v0 {
            Adt11::C0(h343, _, _, _, _, _) => {
                h343
            }
        }
    }
}

pub fn f92(v0: Fn15, p347: bool, p348: List<Str>) -> bool {
    let m346 = (p347, p348);
    {
        let mut m346 = m346;
        loop {
            let step = {
                let (v1, v2) = m346;
                let m344 = v2;
                match m344.uncons() {
                    None => {
                        Err::<(bool, List<Str>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<Str>), bool>(({
                            let c345: Fn15 = v0.clone();
                            c345.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m346 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f93(v0: Str, v1: bool, v2: Str) -> bool {
    if v1 {
        true
    } else {
        let a349 = v2;
        let a350 = v0;
        equal(a349, a350)
    }
}

pub fn f94(v0: Fn16, p354: List<Bytes>, p355: List<(Bytes, Bytes)>) -> R<List<Bytes>> {
    let m353 = (p354, p355);
    {
        let mut m353 = m353;
        loop {
            let step = {
                let (v1, v2) = m353;
                let m351 = v2;
                match m351.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<(Bytes, Bytes)>), R<List<Bytes>>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<(Bytes, Bytes)>), R<List<Bytes>>>(({
                            let c352: Fn16 = v0.clone();
                            c352.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m353 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f95(v0: List<Str>, v1: Str, v2: List<Bytes>, v3: (Bytes, Bytes)) -> R<List<Bytes>> {
    if f122(v0, {
        let (_, h356) = v3.clone();
        h356
    })? {
        Ok(List::cons(f29(List::cons(f55(Str::lit("file")), List::cons(f55(v1), List::cons({
            let (_, h357) = v3;
            h357
        }, List::<Bytes>::nil())))), v2))
    } else {
        Ok(v2)
    }
}

pub fn f96(v0: Adt9) -> bool {
    let m358 = v0;
    match m358 {
        Adt9::C0 => {
            true
        }
        Adt9::C1 => {
            false
        }
        Adt9::C2 => {
            false
        }
        Adt9::C3 => {
            false
        }
    }
}

pub fn f97(v0: Str, v1: List<(Str, bool)>) -> bool {
    f123(Fn23::F124(v0), false, v1)
}

pub fn f98(v0: Str, v1: Str, v2: List<Adt1>, v3: Adt10) -> bool {
    f125(Fn24::F126(v1, v3, v0), false, v2)
}

pub fn f99(v0: Fn17, p362: List<(Str, Str)>, p363: List<Adt5>) -> List<(Str, Str)> {
    let m361 = (p362, p363);
    {
        let mut m361 = m361;
        loop {
            let step = {
                let (v1, v2) = m361;
                let m359 = v2;
                match m359.uncons() {
                    None => {
                        Err::<(List<(Str, Str)>, List<Adt5>), List<(Str, Str)>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<(Str, Str)>, List<Adt5>), List<(Str, Str)>>(({
                            let c360: Fn17 = v0.clone();
                            c360.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m361 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f100(v0: Str, v1: Str, v2: List<(Str, Str)>, v3: Adt5) -> List<(Str, Str)> {
    let a365 = match v3.clone() {
        Adt5::C0(h364, _, _, _) => {
            h364
        }
    };
    let a366 = v1;
    if if equal(a365, a366) {
        let a368 = match v3.clone() {
            Adt5::C0(_, h367, _, _) => {
                h367
            }
        };
        let a369 = v0;
        equal(a368, a369)
    } else {
        false
    } {
        let a372 = v2;
        let a373 = List::cons((match v3.clone() {
            Adt5::C0(_, _, h370, _) => {
                h370
            }
        }, match v3 {
            Adt5::C0(_, _, _, h371) => {
                h371
            }
        }), List::<(Str, Str)>::nil());
        append_list(a372, a373)
    } else {
        v2
    }
}

pub fn f101(v0: Fn18, p377: Option<Bytes>, p378: List<Bytes>) -> Option<Bytes> {
    let m376 = (p377, p378);
    {
        let mut m376 = m376;
        loop {
            let step = {
                let (v1, v2) = m376;
                let m374 = v2;
                match m374.uncons() {
                    None => {
                        Err::<(Option<Bytes>, List<Bytes>), Option<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Bytes>, List<Bytes>), Option<Bytes>>(({
                            let c375: Fn18 = v0.clone();
                            c375.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m376 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f102(v0: Bytes, v1: Option<Bytes>, v2: Bytes) -> Option<Bytes> {
    let m379 = v1;
    match m379 {
        None => {
            Some(v2)
        }
        Some(v3) => {
            Some({
                let a382 = {
                    let a380 = v3;
                    let a381 = v0;
                    append_bytes(a380, a381)
                };
                let a383 = v2;
                append_bytes(a382, a383)
            })
        }
    }
}

pub fn f103(v0: Bytes, v1: Bytes) -> R<Option<u64>> {
    let v2: u64 = {
        let a384 = v0.clone();
        length_bytes(a384)
    };
    let v3: u64 = {
        let a385 = v1.clone();
        length_bytes(a385)
    };
    let v4: u64 = {
        let (h386, _) = f127(Fn25::F128(v1.clone(), v3, v0.clone(), v2), {
            let a387 = v2;
            let a388 = 1u64;
            nat_add(a387, a388)?
        }, 0u64)?;
        h386
    };
    if f129(v0, v1, v4) {
        Ok(Some(v4))
    } else {
        Ok(None::<u64>)
    }
}

pub fn f104(v0: Bytes, v1: u64) -> Option<u8> {
    let a389 = v0;
    let a390 = v1;
    index_bytes(a389, a390)
}

pub fn f105(v0: Bytes) -> Bytes {
    if f130(v0.clone(), Bytes::lit(&[0x0d])) {
        f37(v0.clone(), 0u64, {
            let a392 = {
                let a391 = v0;
                length_bytes(a391)
            };
            let a393 = 1u64;
            nat_sub(a392, a393)
        })
    } else {
        v0
    }
}

pub fn f106(v0: List<Adt7>, v1: Adt7) -> List<Adt7> {
    let a394 = v0;
    let a395 = List::cons(f131(v1), List::<Adt7>::nil());
    append_list(a394, a395)
}

pub fn f107(v0: Str, v1: Adt8, v2: Str, v3: Str, v4: List<Str>, v5: List<Str>) -> Adt7 {
    Adt7::C0(v0, v1, v2, v3, v4, v5)
}

pub fn f108(v0: Fn19, p399: Option<Str>, p400: List<(List<Str>, Str)>) -> Option<Str> {
    let m398 = (p399, p400);
    {
        let mut m398 = m398;
        loop {
            let step = {
                let (v1, v2) = m398;
                let m396 = v2;
                match m396.uncons() {
                    None => {
                        Err::<(Option<Str>, List<(List<Str>, Str)>), Option<Str>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Str>, List<(List<Str>, Str)>), Option<Str>>(({
                            let c397: Fn19 = v0.clone();
                            c397.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m398 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f109(v0: List<Str>, v1: Option<Str>, v2: (List<Str>, Str)) -> Option<Str> {
    if f132({
        let (h401, _) = v2;
        h401
    }, v0) {
        Some({
            let (_, h402) = v2;
            h402
        })
    } else {
        v1
    }
}

pub fn f110(v0: Bytes) -> R<Bytes> {
    Ok(f133(f134(v0)?))
}

pub fn f111(v0: List<Str>, v1: List<(Bytes, Bytes)>) -> R<Bytes> {
    Ok(f6(f94(Fn16::F135(v0), List::<Bytes>::nil(), v1)?))
}

pub fn f112(v0: Fn20, p406: List<Adt6>, p407: List<Str>) -> List<Adt6> {
    let m405 = (p406, p407);
    {
        let mut m405 = m405;
        loop {
            let step = {
                let (v1, v2) = m405;
                let m403 = v2;
                match m403.uncons() {
                    None => {
                        Err::<(List<Adt6>, List<Str>), List<Adt6>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt6>, List<Str>), List<Adt6>>(({
                            let c404: Fn20 = v0.clone();
                            c404.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m405 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f113(v0: List<Adt6>, v1: List<Adt6>, v2: Str) -> List<Adt6> {
    let m408 = f136(v2, v0);
    match m408 {
        None => {
            v1
        }
        Some(v3) => {
            let a409 = v1;
            let a410 = List::cons(v3, List::<Adt6>::nil());
            append_list(a409, a410)
        }
    }
}

pub fn f114(v0: Adt7, v1: Str, v2: List<Adt6>) -> R<Bytes> {
    Ok(f26(List::cons(f29(List::cons(f55(Str::lit("prism-factory/obligation/1")), List::<Bytes>::nil())), List::cons(f29(List::cons(f55(Str::lit("name")), List::cons(f55(match v0.clone() {
        Adt7::C0(h411, _, _, _, _, _) => {
            h411
        }
    }), List::<Bytes>::nil()))), List::cons(f29(List::cons(f55(Str::lit("kind")), List::cons(f55(f137(match v0.clone() {
        Adt7::C0(_, h412, _, _, _, _) => {
            h412
        }
    })), List::<Bytes>::nil()))), List::cons(f29(List::cons(f55(Str::lit("environment")), List::cons(f55(match v0.clone() {
        Adt7::C0(_, _, h413, _, _, _) => {
            h413
        }
    }), List::<Bytes>::nil()))), List::cons(f29(List::cons(f55(Str::lit("run")), List::cons(f55(match v0.clone() {
        Adt7::C0(_, _, _, h414, _, _) => {
            h414
        }
    }), List::<Bytes>::nil()))), List::cons(f138(Str::lit("input"), match v0 {
        Adt7::C0(_, _, _, _, h415, _) => {
            h415
        }
    }), List::cons(f139(v2)?, List::cons(f29(List::cons(f55(Str::lit("closure")), List::cons(f55(v1), List::<Bytes>::nil()))), List::<Bytes>::nil()))))))))))
}

pub fn f115(v0: List<Adt6>, v1: bool, v2: Str) -> bool {
    let m416 = f136(v2, v0);
    match m416 {
        None => {
            false
        }
        Some(_) => {
            v1
        }
    }
}

pub fn f116(v0: Fn21, p420: List<Adt9>, p421: List<Adt6>) -> List<Adt9> {
    let m419 = (p420, p421);
    {
        let mut m419 = m419;
        loop {
            let step = {
                let (v1, v2) = m419;
                let m417 = v2;
                match m417.uncons() {
                    None => {
                        Err::<(List<Adt9>, List<Adt6>), List<Adt9>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt9>, List<Adt6>), List<Adt9>>(({
                            let c418: Fn21 = v0.clone();
                            c418.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m419 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f117(v0: List<Adt9>, v1: Adt6) -> List<Adt9> {
    let a423 = v0;
    let a424 = List::cons(match v1 {
        Adt6::C0(_, _, h422) => {
            h422
        }
    }, List::<Adt9>::nil());
    append_list(a423, a424)
}

pub fn f118(v0: List<Adt9>) -> bool {
    f140(Fn26::F141, true, v0)
}

pub fn f119(v0: Str, v1: List<(Str, bool)>) -> Option<bool> {
    f142(Fn27::F143(v0), None::<bool>, v1)
}

pub fn f120(v0: Fn22, p428: (Option<Bytes>, List<Bytes>), p429: List<Bytes>) -> (Option<Bytes>, List<Bytes>) {
    let m427 = (p428, p429);
    {
        let mut m427 = m427;
        loop {
            let step = {
                let (v1, v2) = m427;
                let m425 = v2;
                match m425.uncons() {
                    None => {
                        Err::<((Option<Bytes>, List<Bytes>), List<Bytes>), (Option<Bytes>, List<Bytes>)>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<((Option<Bytes>, List<Bytes>), List<Bytes>), (Option<Bytes>, List<Bytes>)>(({
                            let c426: Fn22 = v0.clone();
                            c426.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m427 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f121(v0: (Option<Bytes>, List<Bytes>), v1: Bytes) -> (Option<Bytes>, List<Bytes>) {
    f144(v0, v1)
}

pub fn f122(v0: List<Str>, v1: Bytes) -> R<bool> {
    let a430 = f145(v0.clone(), v1.clone(), true)?;
    let a431 = f145(v0, v1, false)?;
    Ok(nat_lt(a430, a431))
}

pub fn f123(v0: Fn23, p435: bool, p436: List<(Str, bool)>) -> bool {
    let m434 = (p435, p436);
    {
        let mut m434 = m434;
        loop {
            let step = {
                let (v1, v2) = m434;
                let m432 = v2;
                match m432.uncons() {
                    None => {
                        Err::<(bool, List<(Str, bool)>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<(Str, bool)>), bool>(({
                            let c433: Fn23 = v0.clone();
                            c433.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m434 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f124(v0: Str, v1: bool, v2: (Str, bool)) -> bool {
    if v1 {
        true
    } else {
        let a438 = {
            let (h437, _) = v2;
            h437
        };
        let a439 = v0;
        if equal(a438, a439) {
            let a441 = {
                let (_, h440) = v2;
                h440
            };
            bool_not(a441)
        } else {
            false
        }
    }
}

pub fn f125(v0: Fn24, p445: bool, p446: List<Adt1>) -> bool {
    let m444 = (p445, p446);
    {
        let mut m444 = m444;
        loop {
            let step = {
                let (v1, v2) = m444;
                let m442 = v2;
                match m442.uncons() {
                    None => {
                        Err::<(bool, List<Adt1>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<Adt1>), bool>(({
                            let c443: Fn24 = v0.clone();
                            c443.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m444 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f126(v0: Str, v1: Adt10, v2: Str, v3: bool, v4: Adt1) -> bool {
    if v3 {
        true
    } else {
        let a448 = match v4.clone() {
            Adt1::C0(h447, _, _, _, _, _) => {
                h447
            }
        };
        let a449 = v2;
        if equal(a448, a449) {
            let a451 = match v4.clone() {
                Adt1::C0(_, h450, _, _, _, _) => {
                    h450
                }
            };
            let a452 = v0;
            if equal(a451, a452) {
                if match v4.clone() {
                    Adt1::C0(_, _, h453, _, _, _) => {
                        h453
                    }
                } {
                    f43(v4, v1)
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
}

pub fn f127(v0: Fn25, p458: u64, p459: u64) -> R<(u64, bool)> {
    let m457 = (p458, p459);
    {
        let mut m457 = m457;
        loop {
            let step = {
                let (v1, v2) = m457;
                let m454 = v1;
                if m454 == 0 {
                    Err::<(u64, u64), R<(u64, bool)>>(Ok((v2, false)))
                } else {
                    let v3 = m454 - 1;
                    let m456 = {
                        let c455: Fn25 = v0.clone();
                        c455.apply(v2)?
                    };
                    match m456 {
                        None => {
                            Err::<(u64, u64), R<(u64, bool)>>(Ok((v2, true)))
                        }
                        Some(v4) => {
                            Ok::<(u64, u64), R<(u64, bool)>>((v3, v4))
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m457 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f128(v0: Bytes, v1: u64, v2: Bytes, v3: u64, v4: u64) -> R<Option<u64>> {
    if f129(v2, v0, v4) {
        Ok(None::<u64>)
    } else {
        let a462 = {
            let a460 = v4;
            let a461 = v1;
            nat_add(a460, a461)?
        };
        let a463 = v3;
        if nat_lt(a462, a463) {
            Ok(Some({
                let a464 = v4;
                let a465 = 1u64;
                nat_add(a464, a465)?
            }))
        } else {
            Ok(None::<u64>)
        }
    }
}

pub fn f129(v0: Bytes, v1: Bytes, v2: u64) -> bool {
    let m470 = {
        let a467 = v0;
        let a468 = v2;
        let a469 = {
            let a466 = v1.clone();
            length_bytes(a466)
        };
        slice_bytes(a467, a468, a469)
    };
    match m470 {
        None => {
            false
        }
        Some(v3) => {
            let a471 = v3;
            let a472 = v1;
            equal(a471, a472)
        }
    }
}

pub fn f130(v0: Bytes, v1: Bytes) -> bool {
    let v2: u64 = {
        let a473 = v0.clone();
        length_bytes(a473)
    };
    let v3: u64 = {
        let a474 = v1.clone();
        length_bytes(a474)
    };
    let a475 = v3;
    let a476 = v2;
    if nat_le(a475, a476) {
        let m482 = {
            let a479 = v0;
            let a480 = {
                let a477 = v2;
                let a478 = v3;
                nat_sub(a477, a478)
            };
            let a481 = v3;
            slice_bytes(a479, a480, a481)
        };
        match m482 {
            None => {
                false
            }
            Some(v4) => {
                let a483 = v4;
                let a484 = v1;
                equal(a483, a484)
            }
        }
    } else {
        false
    }
}

pub fn f131(v0: Adt7) -> Adt7 {
    Adt7::C0(match v0.clone() {
        Adt7::C0(h485, _, _, _, _, _) => {
            h485
        }
    }, match v0.clone() {
        Adt7::C0(_, h486, _, _, _, _) => {
            h486
        }
    }, Str::lit("prism"), match v0.clone() {
        Adt7::C0(_, _, _, h487, _, _) => {
            h487
        }
    }, match v0.clone() {
        Adt7::C0(_, _, _, _, h488, _) => {
            h488
        }
    }, match v0 {
        Adt7::C0(_, _, _, _, _, h489) => {
            h489
        }
    })
}

pub fn f132(p496: List<Str>, p497: List<Str>) -> bool {
    let m495 = (p496, p497);
    {
        let mut m495 = m495;
        loop {
            let step = {
                let (v0, v1) = m495;
                let m490 = v0;
                match m490.uncons() {
                    None => {
                        let m491 = v1;
                        match m491.uncons() {
                            None => {
                                Err::<(List<Str>, List<Str>), bool>(true)
                            }
                            Some((_, _)) => {
                                Err::<(List<Str>, List<Str>), bool>(false)
                            }
                        }
                    }
                    Some((v4, v5)) => {
                        let m492 = v1;
                        match m492.uncons() {
                            None => {
                                Err::<(List<Str>, List<Str>), bool>(false)
                            }
                            Some((v6, v7)) => {
                                let a493 = v4;
                                let a494 = v6;
                                if equal(a493, a494) {
                                    Ok::<(List<Str>, List<Str>), bool>((v5, v7))
                                } else {
                                    Err::<(List<Str>, List<Str>), bool>(false)
                                }
                            }
                        }
                    }
                }
            };
            match step {
                Ok(next) => { m495 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f133(v0: Adt13) -> Bytes {
    let a518 = f146(match v0.clone() {
        Adt13::C0(h498, _, _, _, _, _, _, _) => {
            h498
        }
    });
    let a519 = {
        let a516 = f146(match v0.clone() {
            Adt13::C0(_, h499, _, _, _, _, _, _) => {
                h499
            }
        });
        let a517 = {
            let a514 = f146(match v0.clone() {
                Adt13::C0(_, _, h500, _, _, _, _, _) => {
                    h500
                }
            });
            let a515 = {
                let a512 = f146(match v0.clone() {
                    Adt13::C0(_, _, _, h501, _, _, _, _) => {
                        h501
                    }
                });
                let a513 = {
                    let a510 = f146(match v0.clone() {
                        Adt13::C0(_, _, _, _, h502, _, _, _) => {
                            h502
                        }
                    });
                    let a511 = {
                        let a508 = f146(match v0.clone() {
                            Adt13::C0(_, _, _, _, _, h503, _, _) => {
                                h503
                            }
                        });
                        let a509 = {
                            let a506 = f146(match v0.clone() {
                                Adt13::C0(_, _, _, _, _, _, h504, _) => {
                                    h504
                                }
                            });
                            let a507 = f146(match v0 {
                                Adt13::C0(_, _, _, _, _, _, _, h505) => {
                                    h505
                                }
                            });
                            append_bytes(a506, a507)
                        };
                        append_bytes(a508, a509)
                    };
                    append_bytes(a510, a511)
                };
                append_bytes(a512, a513)
            };
            append_bytes(a514, a515)
        };
        append_bytes(a516, a517)
    };
    append_bytes(a518, a519)
}

pub fn f134(v0: Bytes) -> R<Adt13> {
    let v1: u64 = {
        let a520 = v0.clone();
        length_bytes(a520)
    };
    let v2: u64 = {
        let a526 = {
            let a523 = {
                let a521 = v1;
                let a522 = 72u64;
                nat_add(a521, a522)?
            };
            let a524 = 64u64;
            let a525 = 0u64;
            nat_quot(a523, a524, a525)
        };
        let a527 = 64u64;
        nat_mul(a526, a527)?
    };
    let (_, h528) = f147(Fn28::F148(v0, v1, v2), {
        let a529 = v2;
        let a530 = 64u64;
        let a531 = 0u64;
        nat_quot(a529, a530, a531)
    }, (0u64, f149()))?;
    Ok(h528)
}

pub fn f135(v0: List<Str>, v1: List<Bytes>, v2: (Bytes, Bytes)) -> R<List<Bytes>> {
    if f122(v0, {
        let (_, h532) = v2.clone();
        h532
    })? {
        Ok(List::cons(f29(List::cons(f55(Str::lit("file")), List::cons({
            let (h533, _) = v2;
            h533
        }, List::cons({
            let (_, h534) = v2;
            h534
        }, List::<Bytes>::nil())))), v1))
    } else {
        Ok(v1)
    }
}

pub fn f136(v0: Str, v1: List<Adt6>) -> Option<Adt6> {
    f150(Fn29::F151(v0), None::<Adt6>, v1)
}

pub fn f137(v0: Adt8) -> Str {
    let m535 = v0;
    match m535 {
        Adt8::C0 => {
            Str::lit("hermetic")
        }
        Adt8::C1 => {
            Str::lit("fetch")
        }
    }
}

pub fn f138(v0: Str, v1: List<Str>) -> Bytes {
    f6(f30(Fn6::F152(v0), List::<Bytes>::nil(), v1))
}

pub fn f139(v0: List<Adt6>) -> R<Bytes> {
    Ok(f6(f7(Fn0::F153, List::<Bytes>::nil(), v0)?))
}

pub fn f140(v0: Fn26, p539: bool, p540: List<Adt9>) -> bool {
    let m538 = (p539, p540);
    {
        let mut m538 = m538;
        loop {
            let step = {
                let (v1, v2) = m538;
                let m536 = v2;
                match m536.uncons() {
                    None => {
                        Err::<(bool, List<Adt9>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<Adt9>), bool>(({
                            let c537: Fn26 = v0.clone();
                            c537.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m538 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f141(v0: bool, v1: Adt9) -> bool {
    if v0 {
        f96(v1)
    } else {
        false
    }
}

pub fn f142(v0: Fn27, p544: Option<bool>, p545: List<(Str, bool)>) -> Option<bool> {
    let m543 = (p544, p545);
    {
        let mut m543 = m543;
        loop {
            let step = {
                let (v1, v2) = m543;
                let m541 = v2;
                match m541.uncons() {
                    None => {
                        Err::<(Option<bool>, List<(Str, bool)>), Option<bool>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<bool>, List<(Str, bool)>), Option<bool>>(({
                            let c542: Fn27 = v0.clone();
                            c542.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m543 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f143(v0: Str, v1: Option<bool>, v2: (Str, bool)) -> Option<bool> {
    let a547 = {
        let (h546, _) = v2;
        h546
    };
    let a548 = v0;
    if equal(a547, a548) {
        let m549 = v1;
        match m549 {
            None => {
                Some({
                    let (_, h551) = v2;
                    h551
                })
            }
            Some(v3) => {
                Some(if v3 {
                    true
                } else {
                    let (_, h550) = v2;
                    h550
                })
            }
        }
    } else {
        v1
    }
}

pub fn f144(v0: (Option<Bytes>, List<Bytes>), v1: Bytes) -> (Option<Bytes>, List<Bytes>) {
    let m553 = {
        let (h552, _) = v0;
        h552
    };
    match m553 {
        None => {
            (Some(v1), {
                let (_, h554) = v0;
                h554
            })
        }
        Some(v2) => {
            (None::<Bytes>, List::cons({
                let a555 = v2;
                let a556 = v1;
                append_bytes(a555, a556)
            }, {
                let (_, h557) = v0;
                h557
            }))
        }
    }
}

pub fn f145(v0: List<Str>, v1: Bytes, v2: bool) -> R<u64> {
    f154(Fn30::F155(v2, v1), 0u64, v0)
}

pub fn f146(v0: u32) -> Bytes {
    let a586 = f156({
        let a558 = f157(v0, 28u32);
        let a559 = 15u32;
        fixed_u32::bit_and(a558, a559)
    });
    let a587 = {
        let a584 = f156({
            let a560 = f157(v0, 24u32);
            let a561 = 15u32;
            fixed_u32::bit_and(a560, a561)
        });
        let a585 = {
            let a582 = f156({
                let a562 = f157(v0, 20u32);
                let a563 = 15u32;
                fixed_u32::bit_and(a562, a563)
            });
            let a583 = {
                let a580 = f156({
                    let a564 = f157(v0, 16u32);
                    let a565 = 15u32;
                    fixed_u32::bit_and(a564, a565)
                });
                let a581 = {
                    let a578 = f156({
                        let a566 = f157(v0, 12u32);
                        let a567 = 15u32;
                        fixed_u32::bit_and(a566, a567)
                    });
                    let a579 = {
                        let a576 = f156({
                            let a568 = f157(v0, 8u32);
                            let a569 = 15u32;
                            fixed_u32::bit_and(a568, a569)
                        });
                        let a577 = {
                            let a574 = f156({
                                let a570 = f157(v0, 4u32);
                                let a571 = 15u32;
                                fixed_u32::bit_and(a570, a571)
                            });
                            let a575 = f156({
                                let a572 = v0;
                                let a573 = 15u32;
                                fixed_u32::bit_and(a572, a573)
                            });
                            append_bytes(a574, a575)
                        };
                        append_bytes(a576, a577)
                    };
                    append_bytes(a578, a579)
                };
                append_bytes(a580, a581)
            };
            append_bytes(a582, a583)
        };
        append_bytes(a584, a585)
    };
    append_bytes(a586, a587)
}

pub fn f147(v0: Fn28, p591: u64, p592: (u64, Adt13)) -> R<(u64, Adt13)> {
    let m590 = (p591, p592);
    {
        let mut m590 = m590;
        loop {
            let step = {
                let (v1, v2) = m590;
                let m588 = v1;
                if m588 == 0 {
                    Err::<(u64, (u64, Adt13)), R<(u64, Adt13)>>(Ok(v2))
                } else {
                    let v3 = m588 - 1;
                    Ok::<(u64, (u64, Adt13)), R<(u64, Adt13)>>((v3, {
                        let c589: Fn28 = v0.clone();
                        c589.apply(v2)?
                    }))
                }
            };
            match step {
                Ok(next) => { m590 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f148(v0: Bytes, v1: u64, v2: u64, v3: (u64, Adt13)) -> R<(u64, Adt13)> {
    Ok(({
        let a594 = {
            let (h593, _) = v3.clone();
            h593
        };
        let a595 = 64u64;
        nat_add(a594, a595)?
    }, f158({
        let (_, h596) = v3;
        h596
    }, f159(v0, v1, v2, {
        let (h597, _) = v3;
        h597
    })?)?))
}

pub fn f149() -> Adt13 {
    Adt13::C0(1779033703u32, 3144134277u32, 1013904242u32, 2773480762u32, 1359893119u32, 2600822924u32, 528734635u32, 1541459225u32)
}

pub fn f150(v0: Fn29, p601: Option<Adt6>, p602: List<Adt6>) -> Option<Adt6> {
    let m600 = (p601, p602);
    {
        let mut m600 = m600;
        loop {
            let step = {
                let (v1, v2) = m600;
                let m598 = v2;
                match m598.uncons() {
                    None => {
                        Err::<(Option<Adt6>, List<Adt6>), Option<Adt6>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Adt6>, List<Adt6>), Option<Adt6>>(({
                            let c599: Fn29 = v0.clone();
                            c599.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m600 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f151(v0: Str, v1: Option<Adt6>, v2: Adt6) -> Option<Adt6> {
    let a606 = {
        let m605 = match v2.clone() {
            Adt6::C0(h604, _, _) => {
                h604
            }
        };
        match m605 {
            Adt7::C0(h603, _, _, _, _, _) => {
                h603
            }
        }
    };
    let a607 = v0;
    if equal(a606, a607) {
        Some(v2)
    } else {
        v1
    }
}

pub fn f152(v0: Str, v1: List<Bytes>, v2: Str) -> List<Bytes> {
    List::cons(f29(List::cons(f55(v0), List::cons(f55(v2), List::<Bytes>::nil()))), v1)
}

pub fn f153(v0: List<Bytes>, v1: Adt6) -> List<Bytes> {
    List::cons(f29(List::cons(f55(Str::lit("needs")), List::cons(f55({
        let m610 = match v1.clone() {
            Adt6::C0(h609, _, _) => {
                h609
            }
        };
        match m610 {
            Adt7::C0(h608, _, _, _, _, _) => {
                h608
            }
        }
    }), List::cons(f55(match v1 {
        Adt6::C0(_, h611, _) => {
            h611
        }
    }), List::<Bytes>::nil())))), v0)
}

pub fn f154(v0: Fn30, p615: u64, p616: List<Str>) -> R<u64> {
    let m614 = (p615, p616);
    {
        let mut m614 = m614;
        loop {
            let step = {
                let (v1, v2) = m614;
                let m612 = v2;
                match m612.uncons() {
                    None => {
                        Err::<(u64, List<Str>), R<u64>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(u64, List<Str>), R<u64>>(({
                            let c613: Fn30 = v0.clone();
                            c613.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m614 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f155(v0: bool, v1: Bytes, v2: u64, v3: Str) -> R<u64> {
    let a617 = f160(v3.clone(), Bytes::lit(&[0x21]));
    let a618 = v0;
    if equal(a617, a618) {
        let v4: u64 = f161(v3, v1)?;
        let a619 = v2;
        let a620 = v4;
        if nat_lt(a619, a620) {
            Ok(v4)
        } else {
            Ok(v2)
        }
    } else {
        Ok(v2)
    }
}

pub fn f156(v0: u32) -> Bytes {
    let a623 = {
        let a621 = v0;
        let a622 = 8u32;
        fixed_u32::bit_and(a621, a622)
    };
    let a624 = 0u32;
    if equal(a623, a624) {
        let a627 = {
            let a625 = v0;
            let a626 = 4u32;
            fixed_u32::bit_and(a625, a626)
        };
        let a628 = 0u32;
        if equal(a627, a628) {
            let a631 = {
                let a629 = v0;
                let a630 = 2u32;
                fixed_u32::bit_and(a629, a630)
            };
            let a632 = 0u32;
            if equal(a631, a632) {
                let a635 = {
                    let a633 = v0;
                    let a634 = 1u32;
                    fixed_u32::bit_and(a633, a634)
                };
                let a636 = 0u32;
                if equal(a635, a636) {
                    Bytes::lit(&[0x30])
                } else {
                    Bytes::lit(&[0x31])
                }
            } else {
                let a639 = {
                    let a637 = v0;
                    let a638 = 1u32;
                    fixed_u32::bit_and(a637, a638)
                };
                let a640 = 0u32;
                if equal(a639, a640) {
                    Bytes::lit(&[0x32])
                } else {
                    Bytes::lit(&[0x33])
                }
            }
        } else {
            let a643 = {
                let a641 = v0;
                let a642 = 2u32;
                fixed_u32::bit_and(a641, a642)
            };
            let a644 = 0u32;
            if equal(a643, a644) {
                let a647 = {
                    let a645 = v0;
                    let a646 = 1u32;
                    fixed_u32::bit_and(a645, a646)
                };
                let a648 = 0u32;
                if equal(a647, a648) {
                    Bytes::lit(&[0x34])
                } else {
                    Bytes::lit(&[0x35])
                }
            } else {
                let a651 = {
                    let a649 = v0;
                    let a650 = 1u32;
                    fixed_u32::bit_and(a649, a650)
                };
                let a652 = 0u32;
                if equal(a651, a652) {
                    Bytes::lit(&[0x36])
                } else {
                    Bytes::lit(&[0x37])
                }
            }
        }
    } else {
        let a655 = {
            let a653 = v0;
            let a654 = 4u32;
            fixed_u32::bit_and(a653, a654)
        };
        let a656 = 0u32;
        if equal(a655, a656) {
            let a659 = {
                let a657 = v0;
                let a658 = 2u32;
                fixed_u32::bit_and(a657, a658)
            };
            let a660 = 0u32;
            if equal(a659, a660) {
                let a663 = {
                    let a661 = v0;
                    let a662 = 1u32;
                    fixed_u32::bit_and(a661, a662)
                };
                let a664 = 0u32;
                if equal(a663, a664) {
                    Bytes::lit(&[0x38])
                } else {
                    Bytes::lit(&[0x39])
                }
            } else {
                let a667 = {
                    let a665 = v0;
                    let a666 = 1u32;
                    fixed_u32::bit_and(a665, a666)
                };
                let a668 = 0u32;
                if equal(a667, a668) {
                    Bytes::lit(&[0x61])
                } else {
                    Bytes::lit(&[0x62])
                }
            }
        } else {
            let a671 = {
                let a669 = v0;
                let a670 = 2u32;
                fixed_u32::bit_and(a669, a670)
            };
            let a672 = 0u32;
            if equal(a671, a672) {
                let a675 = {
                    let a673 = v0;
                    let a674 = 1u32;
                    fixed_u32::bit_and(a673, a674)
                };
                let a676 = 0u32;
                if equal(a675, a676) {
                    Bytes::lit(&[0x63])
                } else {
                    Bytes::lit(&[0x64])
                }
            } else {
                let a679 = {
                    let a677 = v0;
                    let a678 = 1u32;
                    fixed_u32::bit_and(a677, a678)
                };
                let a680 = 0u32;
                if equal(a679, a680) {
                    Bytes::lit(&[0x65])
                } else {
                    Bytes::lit(&[0x66])
                }
            }
        }
    }
}

pub fn f157(v0: u32, v1: u32) -> u32 {
    let m683 = {
        let a681 = v0;
        let a682 = v1;
        fixed_u32::shift_right(a681, a682)
    };
    match m683 {
        None => {
            0u32
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f158(v0: Adt13, v1: Adt14) -> R<Adt13> {
    let v2: Adt15 = f162(Fn31::F163, 64u64, Adt15::C0(match v0.clone() {
        Adt13::C0(h684, _, _, _, _, _, _, _) => {
            h684
        }
    }, match v0.clone() {
        Adt13::C0(_, h685, _, _, _, _, _, _) => {
            h685
        }
    }, match v0.clone() {
        Adt13::C0(_, _, h686, _, _, _, _, _) => {
            h686
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, h687, _, _, _, _) => {
            h687
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, h688, _, _, _) => {
            h688
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, h689, _, _) => {
            h689
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, h690, _) => {
            h690
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, h691) => {
            h691
        }
    }, v1, 0u64))?;
    Ok(Adt13::C0(f164(match v0.clone() {
        Adt13::C0(h692, _, _, _, _, _, _, _) => {
            h692
        }
    }, match v2.clone() {
        Adt15::C0(h693, _, _, _, _, _, _, _, _, _) => {
            h693
        }
    }), f164(match v0.clone() {
        Adt13::C0(_, h694, _, _, _, _, _, _) => {
            h694
        }
    }, match v2.clone() {
        Adt15::C0(_, h695, _, _, _, _, _, _, _, _) => {
            h695
        }
    }), f164(match v0.clone() {
        Adt13::C0(_, _, h696, _, _, _, _, _) => {
            h696
        }
    }, match v2.clone() {
        Adt15::C0(_, _, h697, _, _, _, _, _, _, _) => {
            h697
        }
    }), f164(match v0.clone() {
        Adt13::C0(_, _, _, h698, _, _, _, _) => {
            h698
        }
    }, match v2.clone() {
        Adt15::C0(_, _, _, h699, _, _, _, _, _, _) => {
            h699
        }
    }), f164(match v0.clone() {
        Adt13::C0(_, _, _, _, h700, _, _, _) => {
            h700
        }
    }, match v2.clone() {
        Adt15::C0(_, _, _, _, h701, _, _, _, _, _) => {
            h701
        }
    }), f164(match v0.clone() {
        Adt13::C0(_, _, _, _, _, h702, _, _) => {
            h702
        }
    }, match v2.clone() {
        Adt15::C0(_, _, _, _, _, h703, _, _, _, _) => {
            h703
        }
    }), f164(match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, h704, _) => {
            h704
        }
    }, match v2.clone() {
        Adt15::C0(_, _, _, _, _, _, h705, _, _, _) => {
            h705
        }
    }), f164(match v0 {
        Adt13::C0(_, _, _, _, _, _, _, h706) => {
            h706
        }
    }, match v2 {
        Adt15::C0(_, _, _, _, _, _, _, h707, _, _) => {
            h707
        }
    })))
}

pub fn f159(v0: Bytes, v1: u64, v2: u64, v3: u64) -> R<Adt14> {
    Ok(Adt14::C0(f165(v0.clone(), v1, v2, v3)?, f165(v0.clone(), v1, v2, {
        let a708 = v3;
        let a709 = 4u64;
        nat_add(a708, a709)?
    })?, f165(v0.clone(), v1, v2, {
        let a710 = v3;
        let a711 = 8u64;
        nat_add(a710, a711)?
    })?, f165(v0.clone(), v1, v2, {
        let a712 = v3;
        let a713 = 12u64;
        nat_add(a712, a713)?
    })?, f165(v0.clone(), v1, v2, {
        let a714 = v3;
        let a715 = 16u64;
        nat_add(a714, a715)?
    })?, f165(v0.clone(), v1, v2, {
        let a716 = v3;
        let a717 = 20u64;
        nat_add(a716, a717)?
    })?, f165(v0.clone(), v1, v2, {
        let a718 = v3;
        let a719 = 24u64;
        nat_add(a718, a719)?
    })?, f165(v0.clone(), v1, v2, {
        let a720 = v3;
        let a721 = 28u64;
        nat_add(a720, a721)?
    })?, f165(v0.clone(), v1, v2, {
        let a722 = v3;
        let a723 = 32u64;
        nat_add(a722, a723)?
    })?, f165(v0.clone(), v1, v2, {
        let a724 = v3;
        let a725 = 36u64;
        nat_add(a724, a725)?
    })?, f165(v0.clone(), v1, v2, {
        let a726 = v3;
        let a727 = 40u64;
        nat_add(a726, a727)?
    })?, f165(v0.clone(), v1, v2, {
        let a728 = v3;
        let a729 = 44u64;
        nat_add(a728, a729)?
    })?, f165(v0.clone(), v1, v2, {
        let a730 = v3;
        let a731 = 48u64;
        nat_add(a730, a731)?
    })?, f165(v0.clone(), v1, v2, {
        let a732 = v3;
        let a733 = 52u64;
        nat_add(a732, a733)?
    })?, f165(v0.clone(), v1, v2, {
        let a734 = v3;
        let a735 = 56u64;
        nat_add(a734, a735)?
    })?, f165(v0, v1, v2, {
        let a736 = v3;
        let a737 = 60u64;
        nat_add(a736, a737)?
    })?))
}

pub fn f160(v0: Str, v1: Bytes) -> bool {
    f166(f55(v0), v1)
}

pub fn f161(v0: Str, v1: Bytes) -> R<u64> {
    let v2: Bytes = if f160(v0.clone(), Bytes::lit(&[0x21])) {
        f167(v0)
    } else {
        f55(v0)
    };
    if f166(v1.clone(), v2.clone()) {
        if f166(v1, Bytes::lit(&[0x40])) {
            if f166(v2.clone(), Bytes::lit(&[0x40])) {
                let a739 = {
                    let a738 = v2;
                    length_bytes(a738)
                };
                let a740 = 1u64;
                nat_add(a739, a740)
            } else {
                Ok(0u64)
            }
        } else {
            let a742 = {
                let a741 = v2;
                length_bytes(a741)
            };
            let a743 = 1u64;
            nat_add(a742, a743)
        }
    } else {
        Ok(0u64)
    }
}

pub fn f162(v0: Fn31, p747: u64, p748: Adt15) -> R<Adt15> {
    let m746 = (p747, p748);
    {
        let mut m746 = m746;
        loop {
            let step = {
                let (v1, v2) = m746;
                let m744 = v1;
                if m744 == 0 {
                    Err::<(u64, Adt15), R<Adt15>>(Ok(v2))
                } else {
                    let v3 = m744 - 1;
                    Ok::<(u64, Adt15), R<Adt15>>((v3, {
                        let c745: Fn31 = v0.clone();
                        c745.apply(v2)?
                    }))
                }
            };
            match step {
                Ok(next) => { m746 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f163(v0: Adt15) -> R<Adt15> {
    f168(v0)
}

pub fn f164(v0: u32, v1: u32) -> u32 {
    let m751 = {
        let a749 = f169(v0);
        let a750 = f169(v1);
        fixed_u64::checked_add(a749, a750)
    };
    match m751 {
        None => {
            0u32
        }
        Some(v2) => {
            f170(v2)
        }
    }
}

pub fn f165(v0: Bytes, v1: u64, v2: u64, v3: u64) -> R<u32> {
    let a754 = {
        let a752 = v3;
        let a753 = 8u64;
        nat_add(a752, a753)?
    };
    let a755 = v2;
    if nat_eq(a754, a755) {
        Ok(f171({
            let a758 = {
                let a756 = v1;
                let a757 = 8u64;
                nat_mul(a756, a757)?
            };
            let a759 = 4294967296u64;
            let a760 = 0u64;
            nat_quot(a758, a759, a760)
        }))
    } else {
        let a763 = {
            let a761 = v3;
            let a762 = 4u64;
            nat_add(a761, a762)?
        };
        let a764 = v2;
        if nat_eq(a763, a764) {
            Ok(f171({
                let a767 = {
                    let a765 = v1;
                    let a766 = 8u64;
                    nat_mul(a765, a766)?
                };
                let a768 = 4294967296u64;
                let a769 = 0u64;
                nat_rem(a767, a768, a769)
            }))
        } else {
            Ok(f172(f173(v0.clone(), v1, v3), f173(v0.clone(), v1, {
                let a770 = v3;
                let a771 = 1u64;
                nat_add(a770, a771)?
            }), f173(v0.clone(), v1, {
                let a772 = v3;
                let a773 = 2u64;
                nat_add(a772, a773)?
            }), f173(v0, v1, {
                let a774 = v3;
                let a775 = 3u64;
                nat_add(a774, a775)?
            })))
        }
    }
}

pub fn f166(v0: Bytes, v1: Bytes) -> bool {
    let m780 = {
        let a777 = v0;
        let a778 = 0u64;
        let a779 = {
            let a776 = v1.clone();
            length_bytes(a776)
        };
        slice_bytes(a777, a778, a779)
    };
    match m780 {
        None => {
            false
        }
        Some(v2) => {
            let a781 = v2;
            let a782 = v1;
            equal(a781, a782)
        }
    }
}

pub fn f167(v0: Str) -> Bytes {
    let v1: Bytes = f55(v0);
    f37(v1.clone(), 1u64, {
        let a784 = {
            let a783 = v1;
            length_bytes(a783)
        };
        let a785 = 1u64;
        nat_sub(a784, a785)
    })
}

pub fn f168(v0: Adt15) -> R<Adt15> {
    let v1: u32 = f174(match v0.clone() {
        Adt15::C0(_, _, _, _, _, _, _, _, _, h786) => {
            h786
        }
    });
    let v2: u32 = f164(match v0.clone() {
        Adt15::C0(_, _, _, _, _, _, _, h787, _, _) => {
            h787
        }
    }, f164(f175(match v0.clone() {
        Adt15::C0(_, _, _, _, h788, _, _, _, _, _) => {
            h788
        }
    }), f164(f176(match v0.clone() {
        Adt15::C0(_, _, _, _, h789, _, _, _, _, _) => {
            h789
        }
    }, match v0.clone() {
        Adt15::C0(_, _, _, _, _, h790, _, _, _, _) => {
            h790
        }
    }, match v0.clone() {
        Adt15::C0(_, _, _, _, _, _, h791, _, _, _) => {
            h791
        }
    }), f164(v1, {
        let m794 = match v0.clone() {
            Adt15::C0(_, _, _, _, _, _, _, _, h793, _) => {
                h793
            }
        };
        match m794 {
            Adt14::C0(h792, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h792
            }
        }
    }))));
    let v3: u32 = f164(f177(match v0.clone() {
        Adt15::C0(h795, _, _, _, _, _, _, _, _, _) => {
            h795
        }
    }), f178(match v0.clone() {
        Adt15::C0(h796, _, _, _, _, _, _, _, _, _) => {
            h796
        }
    }, match v0.clone() {
        Adt15::C0(_, h797, _, _, _, _, _, _, _, _) => {
            h797
        }
    }, match v0.clone() {
        Adt15::C0(_, _, h798, _, _, _, _, _, _, _) => {
            h798
        }
    }));
    Ok(Adt15::C0(f164(v2, v3), match v0.clone() {
        Adt15::C0(h799, _, _, _, _, _, _, _, _, _) => {
            h799
        }
    }, match v0.clone() {
        Adt15::C0(_, h800, _, _, _, _, _, _, _, _) => {
            h800
        }
    }, match v0.clone() {
        Adt15::C0(_, _, h801, _, _, _, _, _, _, _) => {
            h801
        }
    }, f164(match v0.clone() {
        Adt15::C0(_, _, _, h802, _, _, _, _, _, _) => {
            h802
        }
    }, v2), match v0.clone() {
        Adt15::C0(_, _, _, _, h803, _, _, _, _, _) => {
            h803
        }
    }, match v0.clone() {
        Adt15::C0(_, _, _, _, _, h804, _, _, _, _) => {
            h804
        }
    }, match v0.clone() {
        Adt15::C0(_, _, _, _, _, _, h805, _, _, _) => {
            h805
        }
    }, f179(match v0.clone() {
        Adt15::C0(_, _, _, _, _, _, _, _, h806, _) => {
            h806
        }
    }), {
        let a808 = match v0 {
            Adt15::C0(_, _, _, _, _, _, _, _, _, h807) => {
                h807
            }
        };
        let a809 = 1u64;
        nat_add(a808, a809)?
    }))
}

pub fn f169(v0: u32) -> u64 {
    let m811 = {
        let a810 = v0;
        fixed_u64::convert(i128::from(a810))
    };
    match m811 {
        None => {
            0u64
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f170(v0: u64) -> u32 {
    let m815 = {
        let a814 = {
            let a812 = v0;
            let a813 = 4294967295u64;
            fixed_u64::bit_and(a812, a813)
        };
        fixed_u32::convert(i128::from(a814))
    };
    match m815 {
        None => {
            0u32
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f171(v0: u64) -> u32 {
    let (_, h816) = {
        let (_, h817) = f180(Fn32::F181, 32u64, (v0, (1u32, 0u32)));
        h817
    };
    h816
}

pub fn f172(v0: u32, v1: u32, v2: u32, v3: u32) -> u32 {
    let a822 = f182(v0, 24u32);
    let a823 = {
        let a820 = f182(v1, 16u32);
        let a821 = {
            let a818 = f182(v2, 8u32);
            let a819 = v3;
            fixed_u32::bit_or(a818, a819)
        };
        fixed_u32::bit_or(a820, a821)
    };
    fixed_u32::bit_or(a822, a823)
}

pub fn f173(v0: Bytes, v1: u64, v2: u64) -> u32 {
    let a824 = v2;
    let a825 = v1;
    if nat_lt(a824, a825) {
        let m828 = {
            let a826 = v0;
            let a827 = v2;
            index_bytes(a826, a827)
        };
        match m828 {
            None => {
                0u32
            }
            Some(v3) => {
                let m830 = {
                    let a829 = v3;
                    fixed_u32::convert(i128::from(a829))
                };
                match m830 {
                    None => {
                        0u32
                    }
                    Some(v4) => {
                        v4
                    }
                }
            }
        }
    } else {
        let a831 = v2;
        let a832 = v1;
        if nat_eq(a831, a832) {
            128u32
        } else {
            0u32
        }
    }
}

pub fn f174(v0: u64) -> u32 {
    let a833 = v0;
    let a834 = 32u64;
    if nat_lt(a833, a834) {
        let a835 = v0;
        let a836 = 16u64;
        if nat_lt(a835, a836) {
            let a837 = v0;
            let a838 = 8u64;
            if nat_lt(a837, a838) {
                let a839 = v0;
                let a840 = 4u64;
                if nat_lt(a839, a840) {
                    let a841 = v0;
                    let a842 = 2u64;
                    if nat_lt(a841, a842) {
                        let a843 = v0;
                        let a844 = 1u64;
                        if nat_lt(a843, a844) {
                            1116352408u32
                        } else {
                            1899447441u32
                        }
                    } else {
                        let a845 = v0;
                        let a846 = 3u64;
                        if nat_lt(a845, a846) {
                            3049323471u32
                        } else {
                            3921009573u32
                        }
                    }
                } else {
                    let a847 = v0;
                    let a848 = 6u64;
                    if nat_lt(a847, a848) {
                        let a849 = v0;
                        let a850 = 5u64;
                        if nat_lt(a849, a850) {
                            961987163u32
                        } else {
                            1508970993u32
                        }
                    } else {
                        let a851 = v0;
                        let a852 = 7u64;
                        if nat_lt(a851, a852) {
                            2453635748u32
                        } else {
                            2870763221u32
                        }
                    }
                }
            } else {
                let a853 = v0;
                let a854 = 12u64;
                if nat_lt(a853, a854) {
                    let a855 = v0;
                    let a856 = 10u64;
                    if nat_lt(a855, a856) {
                        let a857 = v0;
                        let a858 = 9u64;
                        if nat_lt(a857, a858) {
                            3624381080u32
                        } else {
                            310598401u32
                        }
                    } else {
                        let a859 = v0;
                        let a860 = 11u64;
                        if nat_lt(a859, a860) {
                            607225278u32
                        } else {
                            1426881987u32
                        }
                    }
                } else {
                    let a861 = v0;
                    let a862 = 14u64;
                    if nat_lt(a861, a862) {
                        let a863 = v0;
                        let a864 = 13u64;
                        if nat_lt(a863, a864) {
                            1925078388u32
                        } else {
                            2162078206u32
                        }
                    } else {
                        let a865 = v0;
                        let a866 = 15u64;
                        if nat_lt(a865, a866) {
                            2614888103u32
                        } else {
                            3248222580u32
                        }
                    }
                }
            }
        } else {
            let a867 = v0;
            let a868 = 24u64;
            if nat_lt(a867, a868) {
                let a869 = v0;
                let a870 = 20u64;
                if nat_lt(a869, a870) {
                    let a871 = v0;
                    let a872 = 18u64;
                    if nat_lt(a871, a872) {
                        let a873 = v0;
                        let a874 = 17u64;
                        if nat_lt(a873, a874) {
                            3835390401u32
                        } else {
                            4022224774u32
                        }
                    } else {
                        let a875 = v0;
                        let a876 = 19u64;
                        if nat_lt(a875, a876) {
                            264347078u32
                        } else {
                            604807628u32
                        }
                    }
                } else {
                    let a877 = v0;
                    let a878 = 22u64;
                    if nat_lt(a877, a878) {
                        let a879 = v0;
                        let a880 = 21u64;
                        if nat_lt(a879, a880) {
                            770255983u32
                        } else {
                            1249150122u32
                        }
                    } else {
                        let a881 = v0;
                        let a882 = 23u64;
                        if nat_lt(a881, a882) {
                            1555081692u32
                        } else {
                            1996064986u32
                        }
                    }
                }
            } else {
                let a883 = v0;
                let a884 = 28u64;
                if nat_lt(a883, a884) {
                    let a885 = v0;
                    let a886 = 26u64;
                    if nat_lt(a885, a886) {
                        let a887 = v0;
                        let a888 = 25u64;
                        if nat_lt(a887, a888) {
                            2554220882u32
                        } else {
                            2821834349u32
                        }
                    } else {
                        let a889 = v0;
                        let a890 = 27u64;
                        if nat_lt(a889, a890) {
                            2952996808u32
                        } else {
                            3210313671u32
                        }
                    }
                } else {
                    let a891 = v0;
                    let a892 = 30u64;
                    if nat_lt(a891, a892) {
                        let a893 = v0;
                        let a894 = 29u64;
                        if nat_lt(a893, a894) {
                            3336571891u32
                        } else {
                            3584528711u32
                        }
                    } else {
                        let a895 = v0;
                        let a896 = 31u64;
                        if nat_lt(a895, a896) {
                            113926993u32
                        } else {
                            338241895u32
                        }
                    }
                }
            }
        }
    } else {
        let a897 = v0;
        let a898 = 48u64;
        if nat_lt(a897, a898) {
            let a899 = v0;
            let a900 = 40u64;
            if nat_lt(a899, a900) {
                let a901 = v0;
                let a902 = 36u64;
                if nat_lt(a901, a902) {
                    let a903 = v0;
                    let a904 = 34u64;
                    if nat_lt(a903, a904) {
                        let a905 = v0;
                        let a906 = 33u64;
                        if nat_lt(a905, a906) {
                            666307205u32
                        } else {
                            773529912u32
                        }
                    } else {
                        let a907 = v0;
                        let a908 = 35u64;
                        if nat_lt(a907, a908) {
                            1294757372u32
                        } else {
                            1396182291u32
                        }
                    }
                } else {
                    let a909 = v0;
                    let a910 = 38u64;
                    if nat_lt(a909, a910) {
                        let a911 = v0;
                        let a912 = 37u64;
                        if nat_lt(a911, a912) {
                            1695183700u32
                        } else {
                            1986661051u32
                        }
                    } else {
                        let a913 = v0;
                        let a914 = 39u64;
                        if nat_lt(a913, a914) {
                            2177026350u32
                        } else {
                            2456956037u32
                        }
                    }
                }
            } else {
                let a915 = v0;
                let a916 = 44u64;
                if nat_lt(a915, a916) {
                    let a917 = v0;
                    let a918 = 42u64;
                    if nat_lt(a917, a918) {
                        let a919 = v0;
                        let a920 = 41u64;
                        if nat_lt(a919, a920) {
                            2730485921u32
                        } else {
                            2820302411u32
                        }
                    } else {
                        let a921 = v0;
                        let a922 = 43u64;
                        if nat_lt(a921, a922) {
                            3259730800u32
                        } else {
                            3345764771u32
                        }
                    }
                } else {
                    let a923 = v0;
                    let a924 = 46u64;
                    if nat_lt(a923, a924) {
                        let a925 = v0;
                        let a926 = 45u64;
                        if nat_lt(a925, a926) {
                            3516065817u32
                        } else {
                            3600352804u32
                        }
                    } else {
                        let a927 = v0;
                        let a928 = 47u64;
                        if nat_lt(a927, a928) {
                            4094571909u32
                        } else {
                            275423344u32
                        }
                    }
                }
            }
        } else {
            let a929 = v0;
            let a930 = 56u64;
            if nat_lt(a929, a930) {
                let a931 = v0;
                let a932 = 52u64;
                if nat_lt(a931, a932) {
                    let a933 = v0;
                    let a934 = 50u64;
                    if nat_lt(a933, a934) {
                        let a935 = v0;
                        let a936 = 49u64;
                        if nat_lt(a935, a936) {
                            430227734u32
                        } else {
                            506948616u32
                        }
                    } else {
                        let a937 = v0;
                        let a938 = 51u64;
                        if nat_lt(a937, a938) {
                            659060556u32
                        } else {
                            883997877u32
                        }
                    }
                } else {
                    let a939 = v0;
                    let a940 = 54u64;
                    if nat_lt(a939, a940) {
                        let a941 = v0;
                        let a942 = 53u64;
                        if nat_lt(a941, a942) {
                            958139571u32
                        } else {
                            1322822218u32
                        }
                    } else {
                        let a943 = v0;
                        let a944 = 55u64;
                        if nat_lt(a943, a944) {
                            1537002063u32
                        } else {
                            1747873779u32
                        }
                    }
                }
            } else {
                let a945 = v0;
                let a946 = 60u64;
                if nat_lt(a945, a946) {
                    let a947 = v0;
                    let a948 = 58u64;
                    if nat_lt(a947, a948) {
                        let a949 = v0;
                        let a950 = 57u64;
                        if nat_lt(a949, a950) {
                            1955562222u32
                        } else {
                            2024104815u32
                        }
                    } else {
                        let a951 = v0;
                        let a952 = 59u64;
                        if nat_lt(a951, a952) {
                            2227730452u32
                        } else {
                            2361852424u32
                        }
                    }
                } else {
                    let a953 = v0;
                    let a954 = 62u64;
                    if nat_lt(a953, a954) {
                        let a955 = v0;
                        let a956 = 61u64;
                        if nat_lt(a955, a956) {
                            2428436474u32
                        } else {
                            2756734187u32
                        }
                    } else {
                        let a957 = v0;
                        let a958 = 63u64;
                        if nat_lt(a957, a958) {
                            3204031479u32
                        } else {
                            3329325298u32
                        }
                    }
                }
            }
        }
    }
}

pub fn f175(v0: u32) -> u32 {
    let a961 = {
        let a959 = f183(v0, 6u32, 26u32);
        let a960 = f183(v0, 11u32, 21u32);
        fixed_u32::bit_xor(a959, a960)
    };
    let a962 = f183(v0, 25u32, 7u32);
    fixed_u32::bit_xor(a961, a962)
}

pub fn f176(v0: u32, v1: u32, v2: u32) -> u32 {
    let a968 = {
        let a963 = v0;
        let a964 = v1;
        fixed_u32::bit_and(a963, a964)
    };
    let a969 = {
        let a966 = {
            let a965 = v0;
            fixed_u32::bit_not(a965)
        };
        let a967 = v2;
        fixed_u32::bit_and(a966, a967)
    };
    fixed_u32::bit_xor(a968, a969)
}

pub fn f177(v0: u32) -> u32 {
    let a972 = {
        let a970 = f183(v0, 2u32, 30u32);
        let a971 = f183(v0, 13u32, 19u32);
        fixed_u32::bit_xor(a970, a971)
    };
    let a973 = f183(v0, 22u32, 10u32);
    fixed_u32::bit_xor(a972, a973)
}

pub fn f178(v0: u32, v1: u32, v2: u32) -> u32 {
    let a982 = {
        let a978 = {
            let a974 = v0;
            let a975 = v1;
            fixed_u32::bit_and(a974, a975)
        };
        let a979 = {
            let a976 = v0;
            let a977 = v2;
            fixed_u32::bit_and(a976, a977)
        };
        fixed_u32::bit_xor(a978, a979)
    };
    let a983 = {
        let a980 = v1;
        let a981 = v2;
        fixed_u32::bit_and(a980, a981)
    };
    fixed_u32::bit_xor(a982, a983)
}

pub fn f179(v0: Adt14) -> Adt14 {
    Adt14::C0(match v0.clone() {
        Adt14::C0(_, h984, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h984
        }
    }, match v0.clone() {
        Adt14::C0(_, _, h985, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h985
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, h986, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h986
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, h987, _, _, _, _, _, _, _, _, _, _, _) => {
            h987
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, h988, _, _, _, _, _, _, _, _, _, _) => {
            h988
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, h989, _, _, _, _, _, _, _, _, _) => {
            h989
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, h990, _, _, _, _, _, _, _, _) => {
            h990
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, h991, _, _, _, _, _, _, _) => {
            h991
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, h992, _, _, _, _, _, _) => {
            h992
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, h993, _, _, _, _, _) => {
            h993
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, h994, _, _, _, _) => {
            h994
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, _, h995, _, _, _) => {
            h995
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, h996, _, _) => {
            h996
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h997, _) => {
            h997
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h998) => {
            h998
        }
    }, f164(f184(match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h999, _) => {
            h999
        }
    }), f164(match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, h1000, _, _, _, _, _, _) => {
            h1000
        }
    }, f164(f185(match v0.clone() {
        Adt14::C0(_, h1001, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h1001
        }
    }), match v0 {
        Adt14::C0(h1002, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h1002
        }
    }))))
}

pub fn f180(v0: Fn32, p1006: u64, p1007: (u64, (u32, u32))) -> (u64, (u32, u32)) {
    let m1005 = (p1006, p1007);
    {
        let mut m1005 = m1005;
        loop {
            let step = {
                let (v1, v2) = m1005;
                let m1003 = v1;
                if m1003 == 0 {
                    Err::<(u64, (u64, (u32, u32))), (u64, (u32, u32))>(v2)
                } else {
                    let v3 = m1003 - 1;
                    Ok::<(u64, (u64, (u32, u32))), (u64, (u32, u32))>((v3, {
                        let c1004: Fn32 = v0.clone();
                        c1004.apply(v2)
                    }))
                }
            };
            match step {
                Ok(next) => { m1005 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f181(v0: (u64, (u32, u32))) -> (u64, (u32, u32)) {
    let v1: u64 = {
        let (h1008, _) = v0;
        h1008
    };
    let v2: u32 = {
        let (h1009, _) = {
            let (_, h1010) = v0;
            h1010
        };
        h1009
    };
    let v3: u32 = {
        let (_, h1011) = {
            let (_, h1012) = v0;
            h1012
        };
        h1011
    };
    ({
        let a1013 = v1;
        let a1014 = 2u64;
        let a1015 = 0u64;
        nat_quot(a1013, a1014, a1015)
    }, (f182(v2, 1u32), {
        let a1019 = {
            let a1016 = v1;
            let a1017 = 2u64;
            let a1018 = 0u64;
            nat_rem(a1016, a1017, a1018)
        };
        let a1020 = 1u64;
        if nat_eq(a1019, a1020) {
            let a1021 = v3;
            let a1022 = v2;
            fixed_u32::bit_or(a1021, a1022)
        } else {
            v3
        }
    }))
}

pub fn f182(v0: u32, v1: u32) -> u32 {
    let m1025 = {
        let a1023 = v0;
        let a1024 = v1;
        fixed_u32::shift_left(a1023, a1024)
    };
    match m1025 {
        None => {
            0u32
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f183(v0: u32, v1: u32, v2: u32) -> u32 {
    let a1026 = f157(v0, v1);
    let a1027 = f182(v0, v2);
    fixed_u32::bit_or(a1026, a1027)
}

pub fn f184(v0: u32) -> u32 {
    let a1030 = {
        let a1028 = f183(v0, 17u32, 15u32);
        let a1029 = f183(v0, 19u32, 13u32);
        fixed_u32::bit_xor(a1028, a1029)
    };
    let a1031 = f157(v0, 10u32);
    fixed_u32::bit_xor(a1030, a1031)
}

pub fn f185(v0: u32) -> u32 {
    let a1034 = {
        let a1032 = f183(v0, 7u32, 25u32);
        let a1033 = f183(v0, 18u32, 14u32);
        fixed_u32::bit_xor(a1032, a1033)
    };
    let a1035 = f157(v0, 3u32);
    fixed_u32::bit_xor(a1034, a1035)
}
