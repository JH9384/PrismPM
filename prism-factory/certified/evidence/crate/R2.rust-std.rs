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
    C0(List<(Bytes, Bytes)>, List<Adt1>, Str, List<Str>, Adt4, List<Adt5>, List<Str>),
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
    C0(Str, Str, Str, Str, Str, Adt12, Str),
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
    F8(List<(Str, bool)>, Adt0, List<Adt6>, List<Str>),
    F163,
}

impl Fn0 {
    pub fn apply(&self, p0: List<Bytes>, p1: Adt6) -> R<List<Bytes>> {
        match self {
            Fn0::F8(k0, k1, k2, k3) => f8(k0.clone(), k1.clone(), k2.clone(), k3.clone(), p0, p1),
            Fn0::F163 => Ok(f163(p0, p1)),
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
    F113,
}

impl Fn5 {
    pub fn apply(&self, p0: List<Adt7>, p1: Adt7) -> List<Adt7> {
        match self {
            Fn5::F24 => f24(p0, p1),
            Fn5::F113 => f113(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn6 {
    F31,
    F107(Str, List<Adt6>, Adt0, Adt10),
    F162(Str),
}

impl Fn6 {
    pub fn apply(&self, p0: List<Bytes>, p1: Str) -> List<Bytes> {
        match self {
            Fn6::F31 => f31(p0, p1),
            Fn6::F107(k0, k1, k2, k3) => f107(k0.clone(), k1.clone(), k2.clone(), k3.clone(), p0, p1),
            Fn6::F162(k0) => f162(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn7 {
    F33(List<(Str, bool)>, List<Str>),
    F135(Str),
}

impl Fn7 {
    pub fn apply(&self, p0: Str, p1: Adt6) -> Str {
        match self {
            Fn7::F33(k0, k1) => f33(k0.clone(), k1.clone(), p0, p1),
            Fn7::F135(k0) => f135(k0.clone(), p0, p1),
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
    F50,
}

impl Fn10 {
    pub fn apply(&self, p0: List<Bytes>) -> Option<List<Bytes>> {
        match self {
            Fn10::F50 => f50(p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn11 {
    F52,
}

impl Fn11 {
    pub fn apply(&self, p0: List<Bytes>, p1: Bytes) -> List<Bytes> {
        match self {
            Fn11::F52 => f52(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn12 {
    F63(Str),
    F105(Str),
    F136(Str, Str),
}

impl Fn12 {
    pub fn apply(&self, p0: List<Bytes>, p1: (Str, Str)) -> List<Bytes> {
        match self {
            Fn12::F63(k0) => f63(k0.clone(), p0, p1),
            Fn12::F105(k0) => f105(k0.clone(), p0, p1),
            Fn12::F136(k0, k1) => f136(k0.clone(), k1.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn13 {
    F77,
}

impl Fn13 {
    pub fn apply(&self, p0: List<Str>, p1: Adt7) -> List<Str> {
        match self {
            Fn13::F77 => f77(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn14 {
    F92(Str),
}

impl Fn14 {
    pub fn apply(&self, p0: Adt11, p1: (Str, Adt11)) -> Adt11 {
        match self {
            Fn14::F92(k0) => f92(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn15 {
    F97(Str),
    F122(List<Adt6>),
}

impl Fn15 {
    pub fn apply(&self, p0: bool, p1: Str) -> bool {
        match self {
            Fn15::F97(k0) => f97(k0.clone(), p0, p1),
            Fn15::F122(k0) => f122(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn16 {
    F99(List<Str>, Str),
    F145(List<Str>),
}

impl Fn16 {
    pub fn apply(&self, p0: List<Bytes>, p1: (Bytes, Bytes)) -> R<List<Bytes>> {
        match self {
            Fn16::F99(k0, k1) => f99(k0.clone(), k1.clone(), p0, p1),
            Fn16::F145(k0) => f145(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn17 {
    F104(Str, Str),
}

impl Fn17 {
    pub fn apply(&self, p0: List<(Str, Str)>, p1: Adt5) -> List<(Str, Str)> {
        match self {
            Fn17::F104(k0, k1) => f104(k0.clone(), k1.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn18 {
    F109(Bytes),
}

impl Fn18 {
    pub fn apply(&self, p0: Option<Bytes>, p1: Bytes) -> Option<Bytes> {
        match self {
            Fn18::F109(k0) => f109(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn19 {
    F116(List<Str>),
}

impl Fn19 {
    pub fn apply(&self, p0: Option<Str>, p1: (List<Str>, Str)) -> Option<Str> {
        match self {
            Fn19::F116(k0) => f116(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn20 {
    F120(List<Adt6>),
}

impl Fn20 {
    pub fn apply(&self, p0: List<Adt6>, p1: Str) -> List<Adt6> {
        match self {
            Fn20::F120(k0) => f120(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn21 {
    F124,
}

impl Fn21 {
    pub fn apply(&self, p0: List<Adt9>, p1: Adt6) -> List<Adt9> {
        match self {
            Fn21::F124 => f124(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn22 {
    F128,
}

impl Fn22 {
    pub fn apply(&self, p0: (Option<Bytes>, List<Bytes>), p1: Bytes) -> (Option<Bytes>, List<Bytes>) {
        match self {
            Fn22::F128 => f128(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn23 {
    F132(Str),
}

impl Fn23 {
    pub fn apply(&self, p0: bool, p1: (Str, bool)) -> bool {
        match self {
            Fn23::F132(k0) => f132(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn24 {
    F134(Str, Adt10, Str),
}

impl Fn24 {
    pub fn apply(&self, p0: bool, p1: Adt1) -> bool {
        match self {
            Fn24::F134(k0, k1, k2) => f134(k0.clone(), k1.clone(), k2.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn25 {
    F138(Bytes, u64, Bytes, u64),
}

impl Fn25 {
    pub fn apply(&self, p0: u64) -> R<Option<u64>> {
        match self {
            Fn25::F138(k0, k1, k2, k3) => f138(k0.clone(), *k1, k2.clone(), *k3, p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn26 {
    F151,
}

impl Fn26 {
    pub fn apply(&self, p0: bool, p1: Adt9) -> bool {
        match self {
            Fn26::F151 => f151(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn27 {
    F153(Str),
}

impl Fn27 {
    pub fn apply(&self, p0: Option<bool>, p1: (Str, bool)) -> Option<bool> {
        match self {
            Fn27::F153(k0) => f153(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn28 {
    F158(Bytes, u64, u64),
}

impl Fn28 {
    pub fn apply(&self, p0: (u64, Adt13)) -> R<(u64, Adt13)> {
        match self {
            Fn28::F158(k0, k1, k2) => f158(k0.clone(), *k1, *k2, p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn29 {
    F161(Str),
}

impl Fn29 {
    pub fn apply(&self, p0: Option<Adt6>, p1: Adt6) -> Option<Adt6> {
        match self {
            Fn29::F161(k0) => f161(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn30 {
    F165(bool, Bytes),
}

impl Fn30 {
    pub fn apply(&self, p0: u64, p1: Str) -> R<u64> {
        match self {
            Fn30::F165(k0, k1) => f165(*k0, k1.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn31 {
    F173,
}

impl Fn31 {
    pub fn apply(&self, p0: Adt15) -> R<Adt15> {
        match self {
            Fn31::F173 => f173(p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn32 {
    F191,
}

impl Fn32 {
    pub fn apply(&self, p0: (u64, (u32, u32))) -> (u64, (u32, u32)) {
        match self {
            Fn32::F191 => f191(p0),
        }
    }
}

pub fn f0(v0: Bytes) -> R<Bytes> {
    let v1: Adt0 = f1(v0)?;
    let v2: List<Str> = f2(match v1.clone() {
        Adt0::C0(_, _, _, _, h1, _, _) => {
            h1
        }
    });
    let v3: List<(Str, bool)> = f3(v1.clone());
    let v4: List<Adt6> = f4(f5(), match v1.clone() {
        Adt0::C0(h2, _, _, _, _, _, _) => {
            h2
        }
    }, v3.clone())?;
    let a5 = f6(f7(Fn0::F8(v3.clone(), v1, v4.clone(), v2.clone()), List::<Bytes>::nil(), v4.clone())?);
    let a6 = {
        let a3 = f9(List::cons(Str::lit("sdk"), List::cons(f10(), List::<Str>::nil())));
        let a4 = f9(List::cons(Str::lit("check"), List::cons(f11(v4, v2, v3), List::<Str>::nil())));
        append_bytes(a3, a4)
    };
    Ok(append_bytes(a5, a6))
}

pub fn f1(v0: Bytes) -> R<Adt0> {
    let v1: Adt0 = f12(Fn1::F13, Adt0::C0(List::<(Bytes, Bytes)>::nil(), List::<Adt1>::nil(), Str::lit(""), List::<Str>::nil(), Adt4::C3, List::<Adt5>::nil(), List::<Str>::nil()), f14(v0)?)?;
    Ok(Adt0::C0(f15(match v1.clone() {
        Adt0::C0(h7, _, _, _, _, _, _) => {
            h7
        }
    }), match v1.clone() {
        Adt0::C0(_, h8, _, _, _, _, _) => {
            h8
        }
    }, match v1.clone() {
        Adt0::C0(_, _, h9, _, _, _, _) => {
            h9
        }
    }, match v1.clone() {
        Adt0::C0(_, _, _, h10, _, _, _) => {
            h10
        }
    }, match v1.clone() {
        Adt0::C0(_, _, _, _, h11, _, _) => {
            h11
        }
    }, match v1.clone() {
        Adt0::C0(_, _, _, _, _, h12, _) => {
            h12
        }
    }, match v1 {
        Adt0::C0(_, _, _, _, _, _, h13) => {
            h13
        }
    }))
}

pub fn f2(v0: Adt4) -> List<Str> {
    f16(Fn2::F17, List::<Str>::nil(), f18(v0))
}

pub fn f3(v0: Adt0) -> List<(Str, bool)> {
    let v1: Adt10 = Adt10::C0(match v0.clone() {
        Adt0::C0(_, _, h14, _, _, _, _) => {
            h14
        }
    }, match v0.clone() {
        Adt0::C0(_, _, _, h15, _, _, _) => {
            h15
        }
    });
    f19(Fn3::F20(v1), List::<(Str, bool)>::nil(), match v0 {
        Adt0::C0(_, h16, _, _, _, _, _) => {
            h16
        }
    })
}

pub fn f4(v0: List<Adt7>, v1: List<(Bytes, Bytes)>, v2: List<(Str, bool)>) -> R<List<Adt6>> {
    let (h17, _) = f21(Fn4::F22(v2, v1), (List::<Adt6>::nil(), List::<(List<Str>, Str)>::nil()), v0)?;
    Ok(h17)
}

pub fn f5() -> List<Adt7> {
    f23(Fn5::F24, List::<Adt7>::nil(), f25())
}

pub fn f6(v0: List<Bytes>) -> Bytes {
    f26(f27(v0))
}

pub fn f7(v0: Fn0, p21: List<Bytes>, p22: List<Adt6>) -> R<List<Bytes>> {
    let m20 = (p21, p22);
    {
        let mut m20 = m20;
        loop {
            let step = {
                let (v1, v2) = m20;
                let m18 = v2;
                match m18.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<Adt6>), R<List<Bytes>>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<Adt6>), R<List<Bytes>>>(({
                            let c19: Fn0 = v0.clone();
                            c19.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m20 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f8(v0: List<(Str, bool)>, v1: Adt0, v2: List<Adt6>, v3: List<Str>, v4: List<Bytes>, v5: Adt6) -> R<List<Bytes>> {
    Ok(List::cons(f28(v5, v3, v1, v0, v2)?, v4))
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

pub fn f12(v0: Fn1, p26: Adt0, p27: List<Bytes>) -> R<Adt0> {
    let m25 = (p26, p27);
    {
        let mut m25 = m25;
        loop {
            let step = {
                let (v1, v2) = m25;
                let m23 = v2;
                match m23.uncons() {
                    None => {
                        Err::<(Adt0, List<Bytes>), R<Adt0>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(Adt0, List<Bytes>), R<Adt0>>(({
                            let c24: Fn1 = v0.clone();
                            c24.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m25 = next; }
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
        let a28 = v0.clone();
        length_bytes(a28)
    };
    let v2: (u64, (u64, List<Bytes>)) = {
        let (h29, _) = f35(Fn8::F36(v0.clone()), v1, (0u64, (0u64, List::<Bytes>::nil())))?;
        h29
    };
    let v3: u64 = {
        let (h30, _) = {
            let (_, h31) = v2.clone();
            h31
        };
        h30
    };
    let v4: List<Bytes> = {
        let (_, h32) = {
            let (_, h33) = v2;
            h33
        };
        h32
    };
    let a34 = v3;
    let a35 = v1;
    if nat_lt(a34, a35) {
        Ok(f27(List::cons(f37(v0, v3, {
            let a36 = v1;
            let a37 = v3;
            nat_sub(a36, a37)
        }), v4)))
    } else {
        Ok(f27(v4))
    }
}

pub fn f15(v0: List<(Bytes, Bytes)>) -> List<(Bytes, Bytes)> {
    f38(Fn9::F39, List::<(Bytes, Bytes)>::nil(), v0)
}

pub fn f16(v0: Fn2, p41: List<Str>, p42: List<Str>) -> List<Str> {
    let m40 = (p41, p42);
    {
        let mut m40 = m40;
        loop {
            let step = {
                let (v1, v2) = m40;
                let m38 = v2;
                match m38.uncons() {
                    None => {
                        Err::<(List<Str>, List<Str>), List<Str>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Str>, List<Str>), List<Str>>(({
                            let c39: Fn2 = v0.clone();
                            c39.apply(v1, v3)
                        }, v4))
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

pub fn f17(v0: List<Str>, v1: Str) -> List<Str> {
    if f40(v1.clone()) {
        let a43 = v0;
        let a44 = List::cons(v1, List::<Str>::nil());
        append_list(a43, a44)
    } else {
        v0
    }
}

pub fn f18(v0: Adt4) -> List<Str> {
    let m45 = v0;
    match m45 {
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

pub fn f19(v0: Fn3, p49: List<(Str, bool)>, p50: List<Adt1>) -> List<(Str, bool)> {
    let m48 = (p49, p50);
    {
        let mut m48 = m48;
        loop {
            let step = {
                let (v1, v2) = m48;
                let m46 = v2;
                match m46.uncons() {
                    None => {
                        Err::<(List<(Str, bool)>, List<Adt1>), List<(Str, bool)>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<(Str, bool)>, List<Adt1>), List<(Str, bool)>>(({
                            let c47: Fn3 = v0.clone();
                            c47.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m48 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f20(v0: Adt10, v1: List<(Str, bool)>, v2: Adt1) -> List<(Str, bool)> {
    if f43(v2.clone(), v0) {
        List::cons((match v2.clone() {
            Adt1::C0(_, h51, _, _, _, _) => {
                h51
            }
        }, match v2 {
            Adt1::C0(_, _, h52, _, _, _) => {
                h52
            }
        }), v1)
    } else {
        v1
    }
}

pub fn f21(v0: Fn4, p56: (List<Adt6>, List<(List<Str>, Str)>), p57: List<Adt7>) -> R<(List<Adt6>, List<(List<Str>, Str)>)> {
    let m55 = (p56, p57);
    {
        let mut m55 = m55;
        loop {
            let step = {
                let (v1, v2) = m55;
                let m53 = v2;
                match m53.uncons() {
                    None => {
                        Err::<((List<Adt6>, List<(List<Str>, Str)>), List<Adt7>), R<(List<Adt6>, List<(List<Str>, Str)>)>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<((List<Adt6>, List<(List<Str>, Str)>), List<Adt7>), R<(List<Adt6>, List<(List<Str>, Str)>)>>(({
                            let c54: Fn4 = v0.clone();
                            c54.apply(v1, v3)?
                        }, v4))
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

pub fn f22(v0: List<(Str, bool)>, v1: List<(Bytes, Bytes)>, v2: (List<Adt6>, List<(List<Str>, Str)>), v3: Adt7) -> R<(List<Adt6>, List<(List<Str>, Str)>)> {
    f44(v1, v0, v2, v3)
}

pub fn f23(v0: Fn5, p61: List<Adt7>, p62: List<Adt7>) -> List<Adt7> {
    let m60 = (p61, p62);
    {
        let mut m60 = m60;
        loop {
            let step = {
                let (v1, v2) = m60;
                let m58 = v2;
                match m58.uncons() {
                    None => {
                        Err::<(List<Adt7>, List<Adt7>), List<Adt7>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt7>, List<Adt7>), List<Adt7>>(({
                            let c59: Fn5 = v0.clone();
                            c59.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m60 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f24(v0: List<Adt7>, v1: Adt7) -> List<Adt7> {
    let a63 = v0;
    let a64 = List::cons(f45(v1), List::<Adt7>::nil());
    append_list(a63, a64)
}

pub fn f25() -> List<Adt7> {
    let a69 = {
        let a67 = {
            let a65 = f46();
            let a66 = f42();
            append_list(a65, a66)
        };
        let a68 = f47();
        append_list(a67, a68)
    };
    let a70 = f48();
    append_list(a69, a70)
}

pub fn f26(v0: List<Bytes>) -> Bytes {
    let m73 = {
        let (h71, _) = f49(Fn10::F50, {
            let a72 = v0.clone();
            length_list(a72)
        }, v0);
        h71
    };
    match m73.uncons() {
        None => {
            Bytes::lit(&[])
        }
        Some((v1, _)) => {
            v1
        }
    }
}

pub fn f27(v0: List<Bytes>) -> List<Bytes> {
    f51(Fn11::F52, List::<Bytes>::nil(), v0)
}

pub fn f28(v0: Adt6, v1: List<Str>, v2: Adt0, v3: List<(Str, bool)>, v4: List<Adt6>) -> R<Bytes> {
    let v5: List<(Bytes, Bytes)> = match v2.clone() {
        Adt0::C0(h74, _, _, _, _, _, _) => {
            h74
        }
    };
    let v6: Adt7 = match v0.clone() {
        Adt6::C0(h75, _, _) => {
            h75
        }
    };
    let v7: Str = match v6.clone() {
        Adt7::C0(h76, _, _, _, _, _) => {
            h76
        }
    };
    let v8: Adt11 = f53(v7.clone());
    let v9: Bytes = {
        let a84 = {
            let a80 = f9(List::cons(Str::lit("obligation"), List::cons(v7.clone(), List::cons(f54(match v0.clone() {
                Adt6::C0(_, _, h77) => {
                    h77
                }
            }), List::cons(match v0.clone() {
                Adt6::C0(_, h78, _) => {
                    h78
                }
            }, List::<Str>::nil())))));
            let a81 = f9(List::cons(Str::lit("run"), List::cons(v7.clone(), List::cons(match v6.clone() {
                Adt7::C0(_, _, _, h79, _, _) => {
                    h79
                }
            }, List::<Str>::nil()))));
            append_bytes(a80, a81)
        };
        let a85 = f9(List::cons(Str::lit("access"), List::cons(v7.clone(), List::cons(f55(match v8.clone() {
            Adt11::C0(_, _, _, _, _, h82, _) => {
                h82
            }
        }), List::cons(match v8.clone() {
            Adt11::C0(h83, _, _, _, _, _, _) => {
                h83
            }
        }, List::<Str>::nil())))));
        append_bytes(a84, a85)
    };
    let v10: Bytes = f29(List::cons(f56(Str::lit("sandbox")), List::cons(f56(v7.clone()), List::cons(f57(v7.clone()), List::<Bytes>::nil()))));
    let v11: bool = if f58(match v0.clone() {
        Adt6::C0(_, _, h86) => {
            h86
        }
    }) {
        if f59(v7.clone(), v1.clone()) {
            let a88 = f59(v7.clone(), match v2.clone() {
                Adt0::C0(_, _, _, _, _, _, h87) => {
                    h87
                }
            });
            bool_not(a88)
        } else {
            false
        }
    } else {
        false
    };
    let v12: Bytes = if v11 {
        let a90 = f9(List::cons(Str::lit("establish"), List::cons(v7.clone(), List::<Str>::nil())));
        let a91 = f60(v7.clone(), match v6.clone() {
            Adt7::C0(_, _, _, _, h89, _) => {
                h89
            }
        }, v5)?;
        append_bytes(a90, a91)
    } else {
        Bytes::lit(&[])
    };
    let v13: Bytes = if f59(v7.clone(), v1) {
        f9(List::cons(Str::lit("status"), List::cons(v7.clone(), List::cons(f61(match v0.clone() {
            Adt6::C0(_, _, h92) => {
                h92
            }
        }, match v0.clone() {
            Adt6::C0(_, h93, _) => {
                h93
            }
        }, v3), List::<Str>::nil()))))
    } else {
        Bytes::lit(&[])
    };
    let v14: Adt10 = Adt10::C0(match v2.clone() {
        Adt0::C0(_, _, h94, _, _, _, _) => {
            h94
        }
    }, match v2.clone() {
        Adt0::C0(_, _, _, h95, _, _, _) => {
            h95
        }
    });
    let v15: Bytes = f26(f62(Fn12::F63(v7.clone()), List::<Bytes>::nil(), f64(v7.clone(), match v0 {
        Adt6::C0(_, h96, _) => {
            h96
        }
    }, match v2.clone() {
        Adt0::C0(_, h97, _, _, _, _, _) => {
            h97
        }
    }, match v2.clone() {
        Adt0::C0(_, _, _, _, _, h98, _) => {
            h98
        }
    }, v14.clone())));
    let v16: Bytes = {
        let a100 = match v8.clone() {
            Adt11::C0(_, _, _, _, _, _, h99) => {
                h99
            }
        };
        let a101 = Str::lit("");
        if equal(a100, a101) {
            Bytes::lit(&[])
        } else {
            f65(v7.clone(), match v8 {
                Adt11::C0(_, _, _, _, _, _, h102) => {
                    h102
                }
            }, v4.clone(), v2.clone(), v14.clone())
        }
    };
    let v17: Bytes = f66(v7, match v6 {
        Adt7::C0(_, _, _, _, _, h103) => {
            h103
        }
    }, v4, v2, v14);
    let a114 = {
        let a112 = {
            let a110 = {
                let a108 = {
                    let a106 = {
                        let a104 = v9;
                        let a105 = v10;
                        append_bytes(a104, a105)
                    };
                    let a107 = v12;
                    append_bytes(a106, a107)
                };
                let a109 = v13;
                append_bytes(a108, a109)
            };
            let a111 = v15;
            append_bytes(a110, a111)
        };
        let a113 = v16;
        append_bytes(a112, a113)
    };
    let a115 = v17;
    Ok(append_bytes(a114, a115))
}

pub fn f29(v0: List<Bytes>) -> Bytes {
    let a116 = f67(v0, Bytes::lit(&[0x20]));
    let a117 = Bytes::lit(&[0x0a]);
    append_bytes(a116, a117)
}

pub fn f30(v0: Fn6, p121: List<Bytes>, p122: List<Str>) -> List<Bytes> {
    let m120 = (p121, p122);
    {
        let mut m120 = m120;
        loop {
            let step = {
                let (v1, v2) = m120;
                let m118 = v2;
                match m118.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<Str>), List<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<Str>), List<Bytes>>(({
                            let c119: Fn6 = v0.clone();
                            c119.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m120 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f31(v0: List<Bytes>, v1: Str) -> List<Bytes> {
    let a123 = v0;
    let a124 = List::cons(f56(v1), List::<Bytes>::nil());
    append_list(a123, a124)
}

pub fn f32(v0: Fn7, p128: Str, p129: List<Adt6>) -> Str {
    let m127 = (p128, p129);
    {
        let mut m127 = m127;
        loop {
            let step = {
                let (v1, v2) = m127;
                let m125 = v2;
                match m125.uncons() {
                    None => {
                        Err::<(Str, List<Adt6>), Str>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Str, List<Adt6>), Str>(({
                            let c126: Fn7 = v0.clone();
                            c126.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m127 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f33(v0: List<(Str, bool)>, v1: List<Str>, v2: Str, v3: Adt6) -> Str {
    if f59({
        let m132 = match v3.clone() {
            Adt6::C0(h131, _, _) => {
                h131
            }
        };
        match m132 {
            Adt7::C0(h130, _, _, _, _, _) => {
                h130
            }
        }
    }, v1) {
        let v4: Str = f61(match v3.clone() {
            Adt6::C0(_, _, h133) => {
                h133
            }
        }, match v3 {
            Adt6::C0(_, h134, _) => {
                h134
            }
        }, v0);
        let a135 = v2.clone();
        let a136 = Str::lit("failure");
        if equal(a135, a136) {
            v2
        } else {
            let a137 = v4.clone();
            let a138 = Str::lit("failure");
            if equal(a137, a138) {
                v4
            } else {
                let a139 = v2.clone();
                let a140 = Str::lit("success");
                if equal(a139, a140) {
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
    let v2: (Bytes, Bytes) = f68(v1)?;
    let v3: Bytes = {
        let (h141, _) = v2.clone();
        h141
    };
    let v4: (Bytes, Bytes) = f68({
        let (_, h142) = v2.clone();
        h142
    })?;
    let a143 = v3.clone();
    let a144 = f56(Str::lit("tree"));
    if equal(a143, a144) {
        Ok(Adt0::C0(List::cons(({
            let (h145, _) = v4;
            h145
        }, {
            let (_, h146) = v4;
            h146
        }), match v0.clone() {
            Adt0::C0(h147, _, _, _, _, _, _) => {
                h147
            }
        }), match v0.clone() {
            Adt0::C0(_, h148, _, _, _, _, _) => {
                h148
            }
        }, match v0.clone() {
            Adt0::C0(_, _, h149, _, _, _, _) => {
                h149
            }
        }, match v0.clone() {
            Adt0::C0(_, _, _, h150, _, _, _) => {
                h150
            }
        }, match v0.clone() {
            Adt0::C0(_, _, _, _, h151, _, _) => {
                h151
            }
        }, match v0.clone() {
            Adt0::C0(_, _, _, _, _, h152, _) => {
                h152
            }
        }, match v0 {
            Adt0::C0(_, _, _, _, _, _, h153) => {
                h153
            }
        }))
    } else {
        let a154 = v3.clone();
        let a155 = f56(Str::lit("signed"));
        if equal(a154, a155) {
            Ok(Adt0::C0(match v0.clone() {
                Adt0::C0(h156, _, _, _, _, _, _) => {
                    h156
                }
            }, {
                let v5: (Bytes, Bytes) = f68({
                    let (_, h157) = v4;
                    h157
                })?;
                let v6: (Bytes, Bytes) = f68({
                    let (_, h158) = v5;
                    h158
                })?;
                let v7: (Bytes, Bytes) = f68({
                    let (_, h159) = v6;
                    h159
                })?;
                let v8: (Bytes, Bytes) = f68({
                    let (_, h160) = v7;
                    h160
                })?;
                List::cons(Adt1::C0(f69({
                    let (h161, _) = v4;
                    h161
                }), f69({
                    let (h162, _) = v5;
                    h162
                }), f70({
                    let (h163, _) = v6;
                    h163
                }), f71({
                    let (h164, _) = v7;
                    h164
                }), f69({
                    let (_, h165) = v8;
                    h165
                }), f72({
                    let (h166, _) = v8;
                    h166
                })), match v0.clone() {
                    Adt0::C0(_, h167, _, _, _, _, _) => {
                        h167
                    }
                })
            }, match v0.clone() {
                Adt0::C0(_, _, h168, _, _, _, _) => {
                    h168
                }
            }, match v0.clone() {
                Adt0::C0(_, _, _, h169, _, _, _) => {
                    h169
                }
            }, match v0.clone() {
                Adt0::C0(_, _, _, _, h170, _, _) => {
                    h170
                }
            }, match v0.clone() {
                Adt0::C0(_, _, _, _, _, h171, _) => {
                    h171
                }
            }, match v0 {
                Adt0::C0(_, _, _, _, _, _, h172) => {
                    h172
                }
            }))
        } else {
            let a173 = v3.clone();
            let a174 = f56(Str::lit("trust-repository"));
            if equal(a173, a174) {
                Ok(Adt0::C0(match v0.clone() {
                    Adt0::C0(h175, _, _, _, _, _, _) => {
                        h175
                    }
                }, match v0.clone() {
                    Adt0::C0(_, h176, _, _, _, _, _) => {
                        h176
                    }
                }, f69({
                    let (_, h177) = v2;
                    h177
                }), match v0.clone() {
                    Adt0::C0(_, _, _, h178, _, _, _) => {
                        h178
                    }
                }, match v0.clone() {
                    Adt0::C0(_, _, _, _, h179, _, _) => {
                        h179
                    }
                }, match v0.clone() {
                    Adt0::C0(_, _, _, _, _, h180, _) => {
                        h180
                    }
                }, match v0 {
                    Adt0::C0(_, _, _, _, _, _, h181) => {
                        h181
                    }
                }))
            } else {
                let a182 = v3.clone();
                let a183 = f56(Str::lit("trust-maintainer"));
                if equal(a182, a183) {
                    Ok(Adt0::C0(match v0.clone() {
                        Adt0::C0(h184, _, _, _, _, _, _) => {
                            h184
                        }
                    }, match v0.clone() {
                        Adt0::C0(_, h185, _, _, _, _, _) => {
                            h185
                        }
                    }, match v0.clone() {
                        Adt0::C0(_, _, h186, _, _, _, _) => {
                            h186
                        }
                    }, List::cons(f69({
                        let (_, h187) = v2;
                        h187
                    }), match v0.clone() {
                        Adt0::C0(_, _, _, h188, _, _, _) => {
                            h188
                        }
                    }), match v0.clone() {
                        Adt0::C0(_, _, _, _, h189, _, _) => {
                            h189
                        }
                    }, match v0.clone() {
                        Adt0::C0(_, _, _, _, _, h190, _) => {
                            h190
                        }
                    }, match v0 {
                        Adt0::C0(_, _, _, _, _, _, h191) => {
                            h191
                        }
                    }))
                } else {
                    let a192 = v3.clone();
                    let a193 = f56(Str::lit("event"));
                    if equal(a192, a193) {
                        Ok(Adt0::C0(match v0.clone() {
                            Adt0::C0(h194, _, _, _, _, _, _) => {
                                h194
                            }
                        }, match v0.clone() {
                            Adt0::C0(_, h195, _, _, _, _, _) => {
                                h195
                            }
                        }, match v0.clone() {
                            Adt0::C0(_, _, h196, _, _, _, _) => {
                                h196
                            }
                        }, match v0.clone() {
                            Adt0::C0(_, _, _, h197, _, _, _) => {
                                h197
                            }
                        }, f73({
                            let (_, h198) = v2;
                            h198
                        }), match v0.clone() {
                            Adt0::C0(_, _, _, _, _, h199, _) => {
                                h199
                            }
                        }, match v0 {
                            Adt0::C0(_, _, _, _, _, _, h200) => {
                                h200
                            }
                        }))
                    } else {
                        let a201 = v3.clone();
                        let a202 = f56(Str::lit("output"));
                        if equal(a201, a202) {
                            Ok(Adt0::C0(match v0.clone() {
                                Adt0::C0(h203, _, _, _, _, _, _) => {
                                    h203
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, h204, _, _, _, _, _) => {
                                    h204
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, h205, _, _, _, _) => {
                                    h205
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, _, h206, _, _, _) => {
                                    h206
                                }
                            }, match v0.clone() {
                                Adt0::C0(_, _, _, _, h207, _, _) => {
                                    h207
                                }
                            }, {
                                let v9: (Bytes, Bytes) = f68({
                                    let (_, h208) = v4;
                                    h208
                                })?;
                                let v10: (Bytes, Bytes) = f68({
                                    let (_, h209) = v9;
                                    h209
                                })?;
                                List::cons(Adt5::C0(f69({
                                    let (h210, _) = v4;
                                    h210
                                }), f69({
                                    let (h211, _) = v9;
                                    h211
                                }), f69({
                                    let (h212, _) = v10;
                                    h212
                                }), f69({
                                    let (_, h213) = v10;
                                    h213
                                })), match v0.clone() {
                                    Adt0::C0(_, _, _, _, _, h214, _) => {
                                        h214
                                    }
                                })
                            }, match v0 {
                                Adt0::C0(_, _, _, _, _, _, h215) => {
                                    h215
                                }
                            }))
                        } else {
                            let a216 = v3;
                            let a217 = f56(Str::lit("attempted"));
                            if equal(a216, a217) {
                                Ok(Adt0::C0(match v0.clone() {
                                    Adt0::C0(h218, _, _, _, _, _, _) => {
                                        h218
                                    }
                                }, match v0.clone() {
                                    Adt0::C0(_, h219, _, _, _, _, _) => {
                                        h219
                                    }
                                }, match v0.clone() {
                                    Adt0::C0(_, _, h220, _, _, _, _) => {
                                        h220
                                    }
                                }, match v0.clone() {
                                    Adt0::C0(_, _, _, h221, _, _, _) => {
                                        h221
                                    }
                                }, match v0.clone() {
                                    Adt0::C0(_, _, _, _, h222, _, _) => {
                                        h222
                                    }
                                }, match v0.clone() {
                                    Adt0::C0(_, _, _, _, _, h223, _) => {
                                        h223
                                    }
                                }, List::cons(f69({
                                    let (_, h224) = v2;
                                    h224
                                }), match v0 {
                                    Adt0::C0(_, _, _, _, _, _, h225) => {
                                        h225
                                    }
                                })))
                            } else {
                                Ok(v0)
                            }
                        }
                    }
                }
            }
        }
    }
}

pub fn f35(v0: Fn8, p230: u64, p231: (u64, (u64, List<Bytes>))) -> R<((u64, (u64, List<Bytes>)), bool)> {
    let m229 = (p230, p231);
    {
        let mut m229 = m229;
        loop {
            let step = {
                let (v1, v2) = m229;
                let m226 = v1;
                if m226 == 0 {
                    Err::<(u64, (u64, (u64, List<Bytes>))), R<((u64, (u64, List<Bytes>)), bool)>>(Ok((v2, false)))
                } else {
                    let v3 = m226 - 1;
                    let m228 = {
                        let c227: Fn8 = v0.clone();
                        c227.apply(v2.clone())?
                    };
                    match m228 {
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
                Ok(next) => { m229 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f36(v0: Bytes, v1: (u64, (u64, List<Bytes>))) -> R<Option<(u64, (u64, List<Bytes>))>> {
    f74(v0, v1)
}

pub fn f37(v0: Bytes, v1: u64, v2: u64) -> Bytes {
    let m235 = {
        let a232 = v0;
        let a233 = v1;
        let a234 = v2;
        slice_bytes(a232, a233, a234)
    };
    match m235 {
        None => {
            Bytes::lit(&[])
        }
        Some(v3) => {
            v3
        }
    }
}

pub fn f38(v0: Fn9, p239: List<(Bytes, Bytes)>, p240: List<(Bytes, Bytes)>) -> List<(Bytes, Bytes)> {
    let m238 = (p239, p240);
    {
        let mut m238 = m238;
        loop {
            let step = {
                let (v1, v2) = m238;
                let m236 = v2;
                match m236.uncons() {
                    None => {
                        Err::<(List<(Bytes, Bytes)>, List<(Bytes, Bytes)>), List<(Bytes, Bytes)>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<(Bytes, Bytes)>, List<(Bytes, Bytes)>), List<(Bytes, Bytes)>>(({
                            let c237: Fn9 = v0.clone();
                            c237.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m238 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f39(v0: List<(Bytes, Bytes)>, v1: (Bytes, Bytes)) -> List<(Bytes, Bytes)> {
    List::cons(v1, v0)
}

pub fn f40(v0: Str) -> bool {
    f59(v0, f75())
}

pub fn f41(v0: List<Adt7>) -> List<Str> {
    f76(Fn13::F77, List::<Str>::nil(), v0)
}

pub fn f42() -> List<Adt7> {
    f78(f79())
}

pub fn f43(v0: Adt1, v1: Adt10) -> bool {
    let m242 = match v0.clone() {
        Adt1::C0(_, _, _, h241, _, _) => {
            h241
        }
    };
    match m242 {
        Adt2::C0 => {
            let a245 = match v0 {
                Adt1::C0(_, _, _, _, h243, _) => {
                    h243
                }
            };
            let a246 = match v1 {
                Adt10::C0(h244, _) => {
                    h244
                }
            };
            equal(a245, a246)
        }
        Adt2::C1 => {
            f59(match v0 {
                Adt1::C0(_, _, _, _, h247, _) => {
                    h247
                }
            }, match v1 {
                Adt10::C0(_, h248) => {
                    h248
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
        let (h249, _) = v2;
        h249
    };
    let v5: List<(List<Str>, Str)> = {
        let (_, h250) = v2;
        h250
    };
    let v6: List<Str> = match v3.clone() {
        Adt7::C0(_, _, _, _, h251, _) => {
            h251
        }
    };
    let v8: Str = {
        let m252 = f80(v6.clone(), v5.clone());
        match m252 {
            None => {
                f81(v6.clone(), v0)?
            }
            Some(v7) => {
                v7
            }
        }
    };
    let v9: List<Adt6> = f82(match v3.clone() {
        Adt7::C0(_, _, _, _, _, h253) => {
            h253
        }
    }, v4.clone());
    let v10: Str = f83(v3.clone(), v8.clone(), v9.clone())?;
    let v11: List<Adt9> = if f84(match v3.clone() {
        Adt7::C0(_, _, _, _, _, h254) => {
            h254
        }
    }, v4.clone()) {
        f85(v9)
    } else {
        List::cons(Adt9::C3, List::<Adt9>::nil())
    };
    Ok(({
        let a256 = v4;
        let a257 = List::cons(Adt6::C0(v3.clone(), v10.clone(), f86(match v3 {
            Adt7::C0(_, h255, _, _, _, _) => {
                h255
            }
        }, v10, v1, v11)), List::<Adt6>::nil());
        append_list(a256, a257)
    }, List::cons((v6, v8), v5)))
}

pub fn f45(v0: Adt7) -> Adt7 {
    Adt7::C0(match v0.clone() {
        Adt7::C0(h258, _, _, _, _, _) => {
            h258
        }
    }, match v0.clone() {
        Adt7::C0(_, h259, _, _, _, _) => {
            h259
        }
    }, f69(f57(match v0.clone() {
        Adt7::C0(h260, _, _, _, _, _) => {
            h260
        }
    })), match v0.clone() {
        Adt7::C0(_, _, _, h261, _, _) => {
            h261
        }
    }, match v0.clone() {
        Adt7::C0(_, _, _, _, h262, _) => {
            h262
        }
    }, match v0 {
        Adt7::C0(_, _, _, _, _, h263) => {
            h263
        }
    })
}

pub fn f46() -> List<Adt7> {
    f78(f87())
}

pub fn f47() -> List<Adt7> {
    f78(f88())
}

pub fn f48() -> List<Adt7> {
    f78(f89())
}

pub fn f49(v0: Fn10, p268: u64, p269: List<Bytes>) -> (List<Bytes>, bool) {
    let m267 = (p268, p269);
    {
        let mut m267 = m267;
        loop {
            let step = {
                let (v1, v2) = m267;
                let m264 = v1;
                if m264 == 0 {
                    Err::<(u64, List<Bytes>), (List<Bytes>, bool)>((v2, false))
                } else {
                    let v3 = m264 - 1;
                    let m266 = {
                        let c265: Fn10 = v0.clone();
                        c265.apply(v2.clone())
                    };
                    match m266 {
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
                Ok(next) => { m267 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f50(v0: List<Bytes>) -> Option<List<Bytes>> {
    f90(v0)
}

pub fn f51(v0: Fn11, p273: List<Bytes>, p274: List<Bytes>) -> List<Bytes> {
    let m272 = (p273, p274);
    {
        let mut m272 = m272;
        loop {
            let step = {
                let (v1, v2) = m272;
                let m270 = v2;
                match m270.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<Bytes>), List<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<Bytes>), List<Bytes>>(({
                            let c271: Fn11 = v0.clone();
                            c271.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m272 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f52(v0: List<Bytes>, v1: Bytes) -> List<Bytes> {
    List::cons(v1, v0)
}

pub fn f53(v0: Str) -> Adt11 {
    f91(Fn14::F92(v0), f93(Str::lit("@sdk"), Adt12::C0), f94())
}

pub fn f54(v0: Adt9) -> Str {
    let m275 = v0;
    match m275 {
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

pub fn f55(v0: Adt12) -> Str {
    let m276 = v0;
    match m276 {
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

pub fn f56(v0: Str) -> Bytes {
    let a277 = v0;
    utf8_encode(a277)
}

pub fn f57(v0: Str) -> Bytes {
    let v1: Adt11 = f53(v0);
    f67(List::cons({
        let a278 = Str::lit("prism/1");
        utf8_encode(a278)
    }, List::cons({
        let a279 = f95(v1.clone());
        utf8_encode(a279)
    }, List::cons({
        let a281 = match v1.clone() {
            Adt11::C0(_, h280, _, _, _, _, _) => {
                h280
            }
        };
        utf8_encode(a281)
    }, List::cons({
        let a283 = match v1.clone() {
            Adt11::C0(_, _, h282, _, _, _, _) => {
                h282
            }
        };
        utf8_encode(a283)
    }, List::cons({
        let a285 = match v1.clone() {
            Adt11::C0(_, _, _, h284, _, _, _) => {
                h284
            }
        };
        utf8_encode(a285)
    }, List::cons({
        let a287 = match v1.clone() {
            Adt11::C0(_, _, _, _, h286, _, _) => {
                h286
            }
        };
        utf8_encode(a287)
    }, List::cons({
        let a289 = f55(match v1 {
            Adt11::C0(_, _, _, _, _, h288, _) => {
                h288
            }
        });
        utf8_encode(a289)
    }, List::<Bytes>::nil()))))))), Bytes::lit(&[0x20]))
}

pub fn f58(v0: Adt9) -> bool {
    let m290 = v0;
    match m290 {
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

pub fn f59(v0: Str, v1: List<Str>) -> bool {
    f96(Fn15::F97(v0), false, v1)
}

pub fn f60(v0: Str, v1: List<Str>, v2: List<(Bytes, Bytes)>) -> R<Bytes> {
    Ok(f6(f98(Fn16::F99(v1, v0), List::<Bytes>::nil(), v2)?))
}

pub fn f61(v0: Adt9, v1: Str, v2: List<(Str, bool)>) -> Str {
    if f100(v0.clone()) {
        Str::lit("success")
    } else {
        let a291 = f54(v0);
        let a292 = Str::lit("refuted");
        if if equal(a291, a292) {
            true
        } else {
            f101(v1, v2)
        } {
            Str::lit("failure")
        } else {
            Str::lit("pending")
        }
    }
}

pub fn f62(v0: Fn12, p296: List<Bytes>, p297: List<(Str, Str)>) -> List<Bytes> {
    let m295 = (p296, p297);
    {
        let mut m295 = m295;
        loop {
            let step = {
                let (v1, v2) = m295;
                let m293 = v2;
                match m293.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<(Str, Str)>), List<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<(Str, Str)>), List<Bytes>>(({
                            let c294: Fn12 = v0.clone();
                            c294.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m295 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f63(v0: Str, v1: List<Bytes>, v2: (Str, Str)) -> List<Bytes> {
    let a300 = v1;
    let a301 = List::cons(f9(List::cons(Str::lit("output"), List::cons(v0, List::cons({
        let (h298, _) = v2;
        h298
    }, List::cons({
        let (_, h299) = v2;
        h299
    }, List::<Str>::nil()))))), List::<Bytes>::nil());
    append_list(a300, a301)
}

pub fn f64(v0: Str, v1: Str, v2: List<Adt1>, v3: List<Adt5>, v4: Adt10) -> List<(Str, Str)> {
    if f102(v0.clone(), v1.clone(), v2, v4) {
        f103(Fn17::F104(v1, v0), List::<(Str, Str)>::nil(), v3)
    } else {
        List::<(Str, Str)>::nil()
    }
}

pub fn f65(v0: Str, v1: Str, v2: List<Adt6>, v3: Adt0, v4: Adt10) -> Bytes {
    f26(f62(Fn12::F105(v0), List::<Bytes>::nil(), f64(v1.clone(), f106(v1, v2), match v3.clone() {
        Adt0::C0(_, h302, _, _, _, _, _) => {
            h302
        }
    }, match v3 {
        Adt0::C0(_, _, _, _, _, h303, _) => {
            h303
        }
    }, v4)))
}

pub fn f66(v0: Str, v1: List<Str>, v2: List<Adt6>, v3: Adt0, v4: Adt10) -> Bytes {
    f26(f30(Fn6::F107(v0, v2, v3, v4), List::<Bytes>::nil(), v1))
}

pub fn f67(v0: List<Bytes>, v1: Bytes) -> Bytes {
    let m304 = f108(Fn18::F109(v1), None::<Bytes>, v0);
    match m304 {
        None => {
            Bytes::lit(&[])
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f68(v0: Bytes) -> R<(Bytes, Bytes)> {
    let m305 = f110(v0.clone(), Bytes::lit(&[0x20]))?;
    match m305 {
        None => {
            Ok((v0, Bytes::lit(&[])))
        }
        Some(v1) => {
            Ok((f37(v0.clone(), 0u64, v1), f37(v0.clone(), {
                let a306 = v1;
                let a307 = 1u64;
                nat_add(a306, a307)?
            }, {
                let a311 = {
                    let a308 = v0;
                    length_bytes(a308)
                };
                let a312 = {
                    let a309 = v1;
                    let a310 = 1u64;
                    nat_add(a309, a310)?
                };
                nat_sub(a311, a312)
            })))
        }
    }
}

pub fn f69(v0: Bytes) -> Str {
    let m314 = {
        let a313 = v0;
        utf8_decode(a313)
    };
    match m314 {
        None => {
            Str::lit("")
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f70(v0: Bytes) -> bool {
    let a315 = v0;
    let a316 = f56(Str::lit("pass"));
    equal(a315, a316)
}

pub fn f71(v0: Bytes) -> Adt2 {
    let a317 = v0.clone();
    let a318 = f56(Str::lit("workflow"));
    if equal(a317, a318) {
        Adt2::C0
    } else {
        let a319 = v0;
        let a320 = f56(Str::lit("maintainer"));
        if equal(a319, a320) {
            Adt2::C1
        } else {
            Adt2::C2
        }
    }
}

pub fn f72(v0: Bytes) -> Adt3 {
    let a321 = v0.clone();
    let a322 = f56(Str::lit("workstation"));
    if equal(a321, a322) {
        Adt3::C1
    } else {
        let a323 = v0;
        let a324 = f56(Str::lit("browser"));
        if equal(a323, a324) {
            Adt3::C2
        } else {
            Adt3::C0
        }
    }
}

pub fn f73(v0: Bytes) -> Adt4 {
    let a325 = v0.clone();
    let a326 = f56(Str::lit("pull_request"));
    if equal(a325, a326) {
        Adt4::C0
    } else {
        let a327 = v0.clone();
        let a328 = f56(Str::lit("push"));
        if equal(a327, a328) {
            Adt4::C1
        } else {
            let a329 = v0;
            let a330 = f56(Str::lit("tag"));
            if equal(a329, a330) {
                Adt4::C2
            } else {
                Adt4::C3
            }
        }
    }
}

pub fn f74(v0: Bytes, v1: (u64, (u64, List<Bytes>))) -> R<Option<(u64, (u64, List<Bytes>))>> {
    let v2: u64 = {
        let (h331, _) = v1.clone();
        h331
    };
    let v3: u64 = {
        let (h332, _) = {
            let (_, h333) = v1.clone();
            h333
        };
        h332
    };
    let v4: List<Bytes> = {
        let (_, h334) = {
            let (_, h335) = v1;
            h335
        };
        h334
    };
    let m336 = f111(v0.clone(), v2);
    match m336 {
        None => {
            Ok(None::<(u64, (u64, List<Bytes>))>)
        }
        Some(v5) => {
            let a337 = v5;
            let a338 = 10u8;
            if equal(a337, a338) {
                Ok(Some(({
                    let a339 = v2;
                    let a340 = 1u64;
                    nat_add(a339, a340)?
                }, ({
                    let a341 = v2;
                    let a342 = 1u64;
                    nat_add(a341, a342)?
                }, List::cons(f112(f37(v0, v3, {
                    let a343 = v2;
                    let a344 = v3;
                    nat_sub(a343, a344)
                })), v4)))))
            } else {
                Ok(Some(({
                    let a345 = v2;
                    let a346 = 1u64;
                    nat_add(a345, a346)?
                }, (v3, v4))))
            }
        }
    }
}

pub fn f75() -> List<Str> {
    List::cons(Str::lit("factory-model"), List::cons(Str::lit("vv-sdk"), List::cons(Str::lit("lint"), List::cons(Str::lit("model-audits"), List::cons(Str::lit("fixtures-golden"), List::cons(Str::lit("devcontainer"), List::cons(Str::lit("vv-conformance"), List::cons(Str::lit("vv-dk-0-1"), List::cons(Str::lit("vv-dk-2"), List::cons(Str::lit("vv-dk-3"), List::cons(Str::lit("vv-gates"), List::cons(Str::lit("vv-ho-oc"), List::cons(Str::lit("vv-source"), List::cons(Str::lit("vv-st-sy"), List::<Str>::nil()))))))))))))))
}

pub fn f76(v0: Fn13, p350: List<Str>, p351: List<Adt7>) -> List<Str> {
    let m349 = (p350, p351);
    {
        let mut m349 = m349;
        loop {
            let step = {
                let (v1, v2) = m349;
                let m347 = v2;
                match m347.uncons() {
                    None => {
                        Err::<(List<Str>, List<Adt7>), List<Str>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Str>, List<Adt7>), List<Str>>(({
                            let c348: Fn13 = v0.clone();
                            c348.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m349 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f77(v0: List<Str>, v1: Adt7) -> List<Str> {
    let a353 = v0;
    let a354 = List::cons(match v1 {
        Adt7::C0(h352, _, _, _, _, _) => {
            h352
        }
    }, List::<Str>::nil());
    append_list(a353, a354)
}

pub fn f78(v0: List<Adt7>) -> List<Adt7> {
    f23(Fn5::F113, List::<Adt7>::nil(), v0)
}

pub fn f79() -> List<Adt7> {
    List::cons(f114(Str::lit("lint"), Adt8::C1, Str::lit("prism"), Str::lit("cargo fetch --locked && cargo fmt --check && cargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings && cargo deny fetch && cargo deny --frozen --all-features check"), List::cons(Str::lit(""), List::<Str>::nil()), List::<Str>::nil()), List::cons(f114(Str::lit("model-audits"), Adt8::C1, Str::lit("prism"), Str::lit("bash scripts/fetch.sh && cargo xtask validate"), List::cons(Str::lit(""), List::cons(Str::lit("@base:model/modules.toml"), List::<Str>::nil())), List::<Str>::nil()), List::cons(f114(Str::lit("fixtures-golden"), Adt8::C1, Str::lit("prism"), Str::lit("cargo fetch --locked && bash scripts/fetch-oracle-cargo.sh && cargo xtask check-fixtures && cargo run --locked --offline --manifest-path tests/holo-codec-oracle/Cargo.toml --target-dir target/holo-codec-oracle && cargo xtask check-golden"), List::cons(Str::lit(""), List::<Str>::nil()), List::<Str>::nil()), List::<Adt7>::nil())))
}

pub fn f80(v0: List<Str>, v1: List<(List<Str>, Str)>) -> Option<Str> {
    f115(Fn19::F116(v0), None::<Str>, v1)
}

pub fn f81(v0: List<Str>, v1: List<(Bytes, Bytes)>) -> R<Str> {
    Ok(f69(f117(f118(v0, v1)?)?))
}

pub fn f82(v0: List<Str>, v1: List<Adt6>) -> List<Adt6> {
    f119(Fn20::F120(v1), List::<Adt6>::nil(), v0)
}

pub fn f83(v0: Adt7, v1: Str, v2: List<Adt6>) -> R<Str> {
    Ok(f69(f117(f121(v0, v1, v2)?)?))
}

pub fn f84(v0: List<Str>, v1: List<Adt6>) -> bool {
    f96(Fn15::F122(v1), true, v0)
}

pub fn f85(v0: List<Adt6>) -> List<Adt9> {
    f123(Fn21::F124, List::<Adt9>::nil(), v0)
}

pub fn f86(v0: Adt8, v1: Str, v2: List<(Str, bool)>, v3: List<Adt9>) -> Adt9 {
    if f125(v3) {
        let m355 = f126(v1, v2);
        match m355 {
            None => {
                Adt9::C1
            }
            Some(v4) => {
                if v4 {
                    Adt9::C0
                } else {
                    let m356 = v0;
                    match m356 {
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

pub fn f87() -> List<Adt7> {
    List::cons(f114(Str::lit("policy"), Adt8::C0, Str::lit("actions"), Str::lit("release.yml/policy"), List::cons(Str::lit(".github/workflows/release.yml"), List::cons(Str::lit("Cargo.toml"), List::cons(Str::lit("model/errors.toml"), List::cons(Str::lit("scripts/"), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil())))))), List::<Str>::nil()), List::cons(f114(Str::lit("factory-model"), Adt8::C0, Str::lit("host"), Str::lit("bash prism-factory/check.sh"), List::cons(Str::lit(".github/workflows/factory.yml"), List::cons(Str::lit(".github/workflows/prism-delegation.yml"), List::cons(Str::lit(".github/workflows/release-cut.yml"), List::cons(Str::lit(".github/workflows/release.yml"), List::cons(Str::lit("prism-factory/"), List::cons(Str::lit("vendor/lexlean/"), List::<Str>::nil())))))), List::<Str>::nil()), List::cons(f114(Str::lit("plumbing"), Adt8::C0, Str::lit("actions"), Str::lit("release.yml/devcontainer-image"), List::cons(Str::lit(""), List::cons(Str::lit("@run"), List::<Str>::nil())), List::cons(Str::lit("policy"), List::<Str>::nil())), List::cons(f114(Str::lit("vv-sdk"), Adt8::C1, Str::lit("actions"), Str::lit("bash prism-factory/obligations/vv-sdk.sh"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/release-rebuild.sh"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/vv-sdk.yml"), List::cons(Str::lit("prism-factory/obligations/history.sh"), List::cons(Str::lit("prism-factory/obligations/image.sh"), List::cons(Str::lit("prism-factory/obligations/vv-sdk.sh"), List::<Str>::nil()))))))))))))))))))))))))))))))))), List::<Str>::nil()), List::cons(f114(Str::lit("source-vv"), Adt8::C1, Str::lit("actions"), Str::lit("release.yml/source-vv"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.mjs"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/release-rebuild.sh"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-candidate-sbom.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/source-vv.yml"), List::<Str>::nil())))))))))))))))))))))))))))))))), List::cons(Str::lit("vv-sdk"), List::<Str>::nil())), List::cons(f114(Str::lit("build"), Adt8::C1, Str::lit("actions"), Str::lit("release.yml/build"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-candidate-sbom.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("scripts/release-gate-evidence.mjs"), List::cons(Str::lit("scripts/release-phases.mjs"), List::cons(Str::lit("scripts/release-rebuild.sh"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/image-platforms.yml"), List::cons(Str::lit("prism-factory/jobs/images.yml"), List::cons(Str::lit("prism-factory/jobs/reproducibility.yml"), List::cons(Str::lit("prism-factory/jobs/native.yml"), List::cons(Str::lit("prism-factory/jobs/installed-sdk.yml"), List::<Str>::nil())))))))))))))))))))))))))))))))))))), List::<Str>::nil()), List::cons(f114(Str::lit("gate"), Adt8::C0, Str::lit("actions"), Str::lit("release.yml/gate"), List::cons(Str::lit(""), List::cons(Str::lit("@run"), List::<Str>::nil())), List::cons(Str::lit("plumbing"), List::cons(Str::lit("source-vv"), List::<Str>::nil()))), List::cons(f114(Str::lit("oci-native"), Adt8::C1, Str::lit("actions"), Str::lit("release.yml/oci-native"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("gate"), List::cons(Str::lit("build"), List::<Str>::nil()))), List::cons(f114(Str::lit("crates"), Adt8::C1, Str::lit("actions"), Str::lit("release.yml/crates"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("oci-native"), List::<Str>::nil())), List::cons(f114(Str::lit("release"), Adt8::C1, Str::lit("actions"), Str::lit("release.yml/release"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("factory-model"), List::cons(Str::lit("crates"), List::<Str>::nil()))), List::<Adt7>::nil()))))))))))
}

pub fn f88() -> List<Adt7> {
    List::cons(f114(Str::lit("devcontainer"), Adt8::C1, Str::lit("prism"), Str::lit("bash prism-factory/obligations/devcontainer.sh"), List::cons(Str::lit(".devcontainer/"), List::cons(Str::lit("prism-factory/obligations/devcontainer.sh"), List::cons(Str::lit("prism-factory/obligations/image.sh"), List::cons(Str::lit("scripts/browser-environment-preflight.mjs"), List::cons(Str::lit("scripts/browser-environment-preflight.sh"), List::cons(Str::lit("sdk/bootstrap/"), List::cons(Str::lit("sdk/browser-engine/"), List::cons(Str::lit("sdk/browser/browser-test-server.mjs"), List::cons(Str::lit("sdk/oracles/go/cloudevents-validator/"), List::cons(Str::lit("sdk/oracles/openid-conformance.sh"), List::cons(Str::lit("sdk/oracles/package-lock.json"), List::cons(Str::lit("sdk/oracles/package.json"), List::cons(Str::lit("standards/oracles/cloudevents-sdk-go-2.16.2/"), List::cons(Str::lit("standards/oracles/oci-distribution-1.1.1/"), List::cons(Str::lit("standards/oracles/oci-image-1.1.1/"), List::cons(Str::lit("standards/oracles/oci-runtime-1.3.0/"), List::cons(Str::lit("standards/oracles/openid-conformance-suite-3e09b13b/"), List::<Str>::nil()))))))))))))))))), List::<Str>::nil()), List::<Adt7>::nil())
}

pub fn f89() -> List<Adt7> {
    List::cons(f114(Str::lit("vv-conformance"), Adt8::C1, Str::lit("prism"), Str::lit("bash prism-factory/obligations/vv-part.sh conformance"), List::cons(Str::lit(""), List::<Str>::nil()), List::cons(Str::lit("vv-sdk"), List::cons(Str::lit("devcontainer"), List::<Str>::nil()))), List::cons(f114(Str::lit("vv-dk-0-1"), Adt8::C1, Str::lit("prism"), Str::lit("bash prism-factory/obligations/vv-part.sh dk-0-1"), List::cons(Str::lit(""), List::<Str>::nil()), List::cons(Str::lit("vv-sdk"), List::cons(Str::lit("devcontainer"), List::<Str>::nil()))), List::cons(f114(Str::lit("vv-dk-2"), Adt8::C1, Str::lit("prism"), Str::lit("bash prism-factory/obligations/vv-part.sh dk-2"), List::cons(Str::lit(""), List::<Str>::nil()), List::cons(Str::lit("vv-sdk"), List::cons(Str::lit("devcontainer"), List::<Str>::nil()))), List::cons(f114(Str::lit("vv-dk-3"), Adt8::C1, Str::lit("prism"), Str::lit("bash prism-factory/obligations/vv-part.sh dk-3"), List::cons(Str::lit(""), List::<Str>::nil()), List::cons(Str::lit("vv-sdk"), List::cons(Str::lit("devcontainer"), List::<Str>::nil()))), List::cons(f114(Str::lit("vv-gates"), Adt8::C1, Str::lit("prism"), Str::lit("bash prism-factory/obligations/vv-part.sh gates"), List::cons(Str::lit(""), List::<Str>::nil()), List::cons(Str::lit("vv-sdk"), List::cons(Str::lit("devcontainer"), List::<Str>::nil()))), List::cons(f114(Str::lit("vv-ho-oc"), Adt8::C1, Str::lit("prism"), Str::lit("bash prism-factory/obligations/vv-part.sh ho-oc"), List::cons(Str::lit(""), List::<Str>::nil()), List::cons(Str::lit("vv-sdk"), List::cons(Str::lit("devcontainer"), List::<Str>::nil()))), List::cons(f114(Str::lit("vv-source"), Adt8::C1, Str::lit("prism"), Str::lit("bash prism-factory/obligations/vv-part.sh source"), List::cons(Str::lit(""), List::<Str>::nil()), List::cons(Str::lit("vv-sdk"), List::cons(Str::lit("devcontainer"), List::<Str>::nil()))), List::cons(f114(Str::lit("vv-st-sy"), Adt8::C1, Str::lit("prism"), Str::lit("bash prism-factory/obligations/vv-part.sh st-sy"), List::cons(Str::lit(""), List::<Str>::nil()), List::cons(Str::lit("vv-sdk"), List::cons(Str::lit("devcontainer"), List::<Str>::nil()))), List::<Adt7>::nil()))))))))
}

pub fn f90(v0: List<Bytes>) -> Option<List<Bytes>> {
    let m357 = v0.clone();
    match m357.uncons() {
        None => {
            None::<List<Bytes>>
        }
        Some((_, v2)) => {
            let m358 = v2;
            match m358.uncons() {
                None => {
                    None::<List<Bytes>>
                }
                Some((_, _)) => {
                    let v5: (Option<Bytes>, List<Bytes>) = f127(Fn22::F128, (None::<Bytes>, List::<Bytes>::nil()), v0);
                    let m360 = {
                        let (h359, _) = v5;
                        h359
                    };
                    match m360 {
                        None => {
                            Some(f27({
                                let (_, h362) = v5;
                                h362
                            }))
                        }
                        Some(v6) => {
                            Some(f27(List::cons(v6, {
                                let (_, h361) = v5;
                                h361
                            })))
                        }
                    }
                }
            }
        }
    }
}

pub fn f91(v0: Fn14, p366: Adt11, p367: List<(Str, Adt11)>) -> Adt11 {
    let m365 = (p366, p367);
    {
        let mut m365 = m365;
        loop {
            let step = {
                let (v1, v2) = m365;
                let m363 = v2;
                match m363.uncons() {
                    None => {
                        Err::<(Adt11, List<(Str, Adt11)>), Adt11>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Adt11, List<(Str, Adt11)>), Adt11>(({
                            let c364: Fn14 = v0.clone();
                            c364.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m365 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f92(v0: Str, v1: Adt11, v2: (Str, Adt11)) -> Adt11 {
    let a369 = {
        let (h368, _) = v2;
        h368
    };
    let a370 = v0;
    if equal(a369, a370) {
        let (_, h371) = v2;
        h371
    } else {
        v1
    }
}

pub fn f93(v0: Str, v1: Adt12) -> Adt11 {
    Adt11::C0(v0, Str::lit("1000:1000"), Str::lit("0022"), Str::lit("tmp/prismpm-home"), Str::lit("tmp"), v1, Str::lit(""))
}

pub fn f94() -> List<(Str, Adt11)> {
    List::cons((Str::lit("policy"), f93(Str::lit("@sdk"), Adt12::C0)), List::cons((Str::lit("factory-model"), f93(Str::lit("@sdk"), Adt12::C1)), List::cons((Str::lit("plumbing"), f93(Str::lit("@sdk"), Adt12::C1)), List::cons((Str::lit("vv-sdk"), f93(Str::lit("@sdk"), Adt12::C3)), List::cons((Str::lit("source-vv"), f93(Str::lit("@vv-sdk"), Adt12::C0)), List::cons((Str::lit("build"), f93(Str::lit("@sdk"), Adt12::C1)), List::cons((Str::lit("gate"), f93(Str::lit("@vv-sdk"), Adt12::C0)), List::cons((Str::lit("oci-native"), f93(Str::lit("@build"), Adt12::C1)), List::cons((Str::lit("crates"), f93(Str::lit("@build"), Adt12::C1)), List::cons((Str::lit("release"), f93(Str::lit("@build"), Adt12::C1)), List::cons((Str::lit("lint"), f93(Str::lit("@sdk"), Adt12::C1)), List::cons((Str::lit("model-audits"), f93(Str::lit("@sdk"), Adt12::C2)), List::cons((Str::lit("fixtures-golden"), f93(Str::lit("@sdk"), Adt12::C1)), List::cons((Str::lit("devcontainer"), f93(Str::lit("@sdk"), Adt12::C3)), List::cons((Str::lit("vv-conformance"), f129(Str::lit("@devcontainer"), Str::lit("devcontainer"), Adt12::C2)), List::cons((Str::lit("vv-dk-0-1"), f129(Str::lit("@devcontainer"), Str::lit("devcontainer"), Adt12::C2)), List::cons((Str::lit("vv-dk-2"), f129(Str::lit("@devcontainer"), Str::lit("devcontainer"), Adt12::C2)), List::cons((Str::lit("vv-dk-3"), f129(Str::lit("@devcontainer"), Str::lit("devcontainer"), Adt12::C2)), List::cons((Str::lit("vv-gates"), f129(Str::lit("@devcontainer"), Str::lit("devcontainer"), Adt12::C2)), List::cons((Str::lit("vv-ho-oc"), f129(Str::lit("@devcontainer"), Str::lit("devcontainer"), Adt12::C2)), List::cons((Str::lit("vv-source"), f129(Str::lit("@devcontainer"), Str::lit("devcontainer"), Adt12::C2)), List::cons((Str::lit("vv-st-sy"), f129(Str::lit("@devcontainer"), Str::lit("devcontainer"), Adt12::C2)), List::<(Str, Adt11)>::nil()))))))))))))))))))))))
}

pub fn f95(v0: Adt11) -> Str {
    let a373 = match v0.clone() {
        Adt11::C0(h372, _, _, _, _, _, _) => {
            h372
        }
    };
    let a374 = Str::lit("@sdk");
    if equal(a373, a374) {
        f10()
    } else {
        match v0 {
            Adt11::C0(h375, _, _, _, _, _, _) => {
                h375
            }
        }
    }
}

pub fn f96(v0: Fn15, p379: bool, p380: List<Str>) -> bool {
    let m378 = (p379, p380);
    {
        let mut m378 = m378;
        loop {
            let step = {
                let (v1, v2) = m378;
                let m376 = v2;
                match m376.uncons() {
                    None => {
                        Err::<(bool, List<Str>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<Str>), bool>(({
                            let c377: Fn15 = v0.clone();
                            c377.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m378 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f97(v0: Str, v1: bool, v2: Str) -> bool {
    if v1 {
        true
    } else {
        let a381 = v2;
        let a382 = v0;
        equal(a381, a382)
    }
}

pub fn f98(v0: Fn16, p386: List<Bytes>, p387: List<(Bytes, Bytes)>) -> R<List<Bytes>> {
    let m385 = (p386, p387);
    {
        let mut m385 = m385;
        loop {
            let step = {
                let (v1, v2) = m385;
                let m383 = v2;
                match m383.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<(Bytes, Bytes)>), R<List<Bytes>>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<(Bytes, Bytes)>), R<List<Bytes>>>(({
                            let c384: Fn16 = v0.clone();
                            c384.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m385 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f99(v0: List<Str>, v1: Str, v2: List<Bytes>, v3: (Bytes, Bytes)) -> R<List<Bytes>> {
    if f130(v0, {
        let (_, h388) = v3.clone();
        h388
    })? {
        Ok(List::cons(f29(List::cons(f56(Str::lit("file")), List::cons(f56(v1), List::cons({
            let (_, h389) = v3;
            h389
        }, List::<Bytes>::nil())))), v2))
    } else {
        Ok(v2)
    }
}

pub fn f100(v0: Adt9) -> bool {
    let m390 = v0;
    match m390 {
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

pub fn f101(v0: Str, v1: List<(Str, bool)>) -> bool {
    f131(Fn23::F132(v0), false, v1)
}

pub fn f102(v0: Str, v1: Str, v2: List<Adt1>, v3: Adt10) -> bool {
    f133(Fn24::F134(v1, v3, v0), false, v2)
}

pub fn f103(v0: Fn17, p394: List<(Str, Str)>, p395: List<Adt5>) -> List<(Str, Str)> {
    let m393 = (p394, p395);
    {
        let mut m393 = m393;
        loop {
            let step = {
                let (v1, v2) = m393;
                let m391 = v2;
                match m391.uncons() {
                    None => {
                        Err::<(List<(Str, Str)>, List<Adt5>), List<(Str, Str)>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<(Str, Str)>, List<Adt5>), List<(Str, Str)>>(({
                            let c392: Fn17 = v0.clone();
                            c392.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m393 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f104(v0: Str, v1: Str, v2: List<(Str, Str)>, v3: Adt5) -> List<(Str, Str)> {
    let a397 = match v3.clone() {
        Adt5::C0(h396, _, _, _) => {
            h396
        }
    };
    let a398 = v1;
    if if equal(a397, a398) {
        let a400 = match v3.clone() {
            Adt5::C0(_, h399, _, _) => {
                h399
            }
        };
        let a401 = v0;
        equal(a400, a401)
    } else {
        false
    } {
        let a404 = v2;
        let a405 = List::cons((match v3.clone() {
            Adt5::C0(_, _, h402, _) => {
                h402
            }
        }, match v3 {
            Adt5::C0(_, _, _, h403) => {
                h403
            }
        }), List::<(Str, Str)>::nil());
        append_list(a404, a405)
    } else {
        v2
    }
}

pub fn f105(v0: Str, v1: List<Bytes>, v2: (Str, Str)) -> List<Bytes> {
    let a407 = {
        let (h406, _) = v2;
        h406
    };
    let a408 = Str::lit("image");
    if equal(a407, a408) {
        let a410 = v1;
        let a411 = List::cons(f9(List::cons(Str::lit("image"), List::cons(v0, List::cons({
            let (_, h409) = v2;
            h409
        }, List::<Str>::nil())))), List::<Bytes>::nil());
        append_list(a410, a411)
    } else {
        v1
    }
}

pub fn f106(v0: Str, v1: List<Adt6>) -> Str {
    f32(Fn7::F135(v0), Str::lit(""), v1)
}

pub fn f107(v0: Str, v1: List<Adt6>, v2: Adt0, v3: Adt10, v4: List<Bytes>, v5: Str) -> List<Bytes> {
    f62(Fn12::F136(v5.clone(), v0), v4, f64(v5.clone(), f106(v5, v1), match v2.clone() {
        Adt0::C0(_, h412, _, _, _, _, _) => {
            h412
        }
    }, match v2 {
        Adt0::C0(_, _, _, _, _, h413, _) => {
            h413
        }
    }, v3))
}

pub fn f108(v0: Fn18, p417: Option<Bytes>, p418: List<Bytes>) -> Option<Bytes> {
    let m416 = (p417, p418);
    {
        let mut m416 = m416;
        loop {
            let step = {
                let (v1, v2) = m416;
                let m414 = v2;
                match m414.uncons() {
                    None => {
                        Err::<(Option<Bytes>, List<Bytes>), Option<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Bytes>, List<Bytes>), Option<Bytes>>(({
                            let c415: Fn18 = v0.clone();
                            c415.apply(v1, v3)
                        }, v4))
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

pub fn f109(v0: Bytes, v1: Option<Bytes>, v2: Bytes) -> Option<Bytes> {
    let m419 = v1;
    match m419 {
        None => {
            Some(v2)
        }
        Some(v3) => {
            Some({
                let a422 = {
                    let a420 = v3;
                    let a421 = v0;
                    append_bytes(a420, a421)
                };
                let a423 = v2;
                append_bytes(a422, a423)
            })
        }
    }
}

pub fn f110(v0: Bytes, v1: Bytes) -> R<Option<u64>> {
    let v2: u64 = {
        let a424 = v0.clone();
        length_bytes(a424)
    };
    let v3: u64 = {
        let a425 = v1.clone();
        length_bytes(a425)
    };
    let v4: u64 = {
        let (h426, _) = f137(Fn25::F138(v1.clone(), v3, v0.clone(), v2), {
            let a427 = v2;
            let a428 = 1u64;
            nat_add(a427, a428)?
        }, 0u64)?;
        h426
    };
    if f139(v0, v1, v4) {
        Ok(Some(v4))
    } else {
        Ok(None::<u64>)
    }
}

pub fn f111(v0: Bytes, v1: u64) -> Option<u8> {
    let a429 = v0;
    let a430 = v1;
    index_bytes(a429, a430)
}

pub fn f112(v0: Bytes) -> Bytes {
    if f140(v0.clone(), Bytes::lit(&[0x0d])) {
        f37(v0.clone(), 0u64, {
            let a432 = {
                let a431 = v0;
                length_bytes(a431)
            };
            let a433 = 1u64;
            nat_sub(a432, a433)
        })
    } else {
        v0
    }
}

pub fn f113(v0: List<Adt7>, v1: Adt7) -> List<Adt7> {
    let a434 = v0;
    let a435 = List::cons(f141(v1), List::<Adt7>::nil());
    append_list(a434, a435)
}

pub fn f114(v0: Str, v1: Adt8, v2: Str, v3: Str, v4: List<Str>, v5: List<Str>) -> Adt7 {
    Adt7::C0(v0, v1, v2, v3, v4, v5)
}

pub fn f115(v0: Fn19, p439: Option<Str>, p440: List<(List<Str>, Str)>) -> Option<Str> {
    let m438 = (p439, p440);
    {
        let mut m438 = m438;
        loop {
            let step = {
                let (v1, v2) = m438;
                let m436 = v2;
                match m436.uncons() {
                    None => {
                        Err::<(Option<Str>, List<(List<Str>, Str)>), Option<Str>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Str>, List<(List<Str>, Str)>), Option<Str>>(({
                            let c437: Fn19 = v0.clone();
                            c437.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m438 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f116(v0: List<Str>, v1: Option<Str>, v2: (List<Str>, Str)) -> Option<Str> {
    if f142({
        let (h441, _) = v2;
        h441
    }, v0) {
        Some({
            let (_, h442) = v2;
            h442
        })
    } else {
        v1
    }
}

pub fn f117(v0: Bytes) -> R<Bytes> {
    Ok(f143(f144(v0)?))
}

pub fn f118(v0: List<Str>, v1: List<(Bytes, Bytes)>) -> R<Bytes> {
    Ok(f6(f98(Fn16::F145(v0), List::<Bytes>::nil(), v1)?))
}

pub fn f119(v0: Fn20, p446: List<Adt6>, p447: List<Str>) -> List<Adt6> {
    let m445 = (p446, p447);
    {
        let mut m445 = m445;
        loop {
            let step = {
                let (v1, v2) = m445;
                let m443 = v2;
                match m443.uncons() {
                    None => {
                        Err::<(List<Adt6>, List<Str>), List<Adt6>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt6>, List<Str>), List<Adt6>>(({
                            let c444: Fn20 = v0.clone();
                            c444.apply(v1, v3)
                        }, v4))
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

pub fn f120(v0: List<Adt6>, v1: List<Adt6>, v2: Str) -> List<Adt6> {
    let m448 = f146(v2, v0);
    match m448 {
        None => {
            v1
        }
        Some(v3) => {
            let a449 = v1;
            let a450 = List::cons(v3, List::<Adt6>::nil());
            append_list(a449, a450)
        }
    }
}

pub fn f121(v0: Adt7, v1: Str, v2: List<Adt6>) -> R<Bytes> {
    Ok(f26(List::cons(f29(List::cons(f56(Str::lit("prism-factory/obligation/1")), List::<Bytes>::nil())), List::cons(f29(List::cons(f56(Str::lit("name")), List::cons(f56(match v0.clone() {
        Adt7::C0(h451, _, _, _, _, _) => {
            h451
        }
    }), List::<Bytes>::nil()))), List::cons(f29(List::cons(f56(Str::lit("kind")), List::cons(f56(f147(match v0.clone() {
        Adt7::C0(_, h452, _, _, _, _) => {
            h452
        }
    })), List::<Bytes>::nil()))), List::cons(f29(List::cons(f56(Str::lit("environment")), List::cons(f56(match v0.clone() {
        Adt7::C0(_, _, h453, _, _, _) => {
            h453
        }
    }), List::<Bytes>::nil()))), List::cons(f29(List::cons(f56(Str::lit("run")), List::cons(f56(match v0.clone() {
        Adt7::C0(_, _, _, h454, _, _) => {
            h454
        }
    }), List::<Bytes>::nil()))), List::cons(f148(Str::lit("input"), match v0 {
        Adt7::C0(_, _, _, _, h455, _) => {
            h455
        }
    }), List::cons(f149(v2)?, List::cons(f29(List::cons(f56(Str::lit("closure")), List::cons(f56(v1), List::<Bytes>::nil()))), List::<Bytes>::nil()))))))))))
}

pub fn f122(v0: List<Adt6>, v1: bool, v2: Str) -> bool {
    let m456 = f146(v2, v0);
    match m456 {
        None => {
            false
        }
        Some(_) => {
            v1
        }
    }
}

pub fn f123(v0: Fn21, p460: List<Adt9>, p461: List<Adt6>) -> List<Adt9> {
    let m459 = (p460, p461);
    {
        let mut m459 = m459;
        loop {
            let step = {
                let (v1, v2) = m459;
                let m457 = v2;
                match m457.uncons() {
                    None => {
                        Err::<(List<Adt9>, List<Adt6>), List<Adt9>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt9>, List<Adt6>), List<Adt9>>(({
                            let c458: Fn21 = v0.clone();
                            c458.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m459 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f124(v0: List<Adt9>, v1: Adt6) -> List<Adt9> {
    let a463 = v0;
    let a464 = List::cons(match v1 {
        Adt6::C0(_, _, h462) => {
            h462
        }
    }, List::<Adt9>::nil());
    append_list(a463, a464)
}

pub fn f125(v0: List<Adt9>) -> bool {
    f150(Fn26::F151, true, v0)
}

pub fn f126(v0: Str, v1: List<(Str, bool)>) -> Option<bool> {
    f152(Fn27::F153(v0), None::<bool>, v1)
}

pub fn f127(v0: Fn22, p468: (Option<Bytes>, List<Bytes>), p469: List<Bytes>) -> (Option<Bytes>, List<Bytes>) {
    let m467 = (p468, p469);
    {
        let mut m467 = m467;
        loop {
            let step = {
                let (v1, v2) = m467;
                let m465 = v2;
                match m465.uncons() {
                    None => {
                        Err::<((Option<Bytes>, List<Bytes>), List<Bytes>), (Option<Bytes>, List<Bytes>)>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<((Option<Bytes>, List<Bytes>), List<Bytes>), (Option<Bytes>, List<Bytes>)>(({
                            let c466: Fn22 = v0.clone();
                            c466.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m467 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f128(v0: (Option<Bytes>, List<Bytes>), v1: Bytes) -> (Option<Bytes>, List<Bytes>) {
    f154(v0, v1)
}

pub fn f129(v0: Str, v1: Str, v2: Adt12) -> Adt11 {
    Adt11::C0(v0, Str::lit("1000:1000"), Str::lit("0022"), Str::lit("tmp/prismpm-home"), Str::lit("tmp"), v2, v1)
}

pub fn f130(v0: List<Str>, v1: Bytes) -> R<bool> {
    let a470 = f155(v0.clone(), v1.clone(), true)?;
    let a471 = f155(v0, v1, false)?;
    Ok(nat_lt(a470, a471))
}

pub fn f131(v0: Fn23, p475: bool, p476: List<(Str, bool)>) -> bool {
    let m474 = (p475, p476);
    {
        let mut m474 = m474;
        loop {
            let step = {
                let (v1, v2) = m474;
                let m472 = v2;
                match m472.uncons() {
                    None => {
                        Err::<(bool, List<(Str, bool)>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<(Str, bool)>), bool>(({
                            let c473: Fn23 = v0.clone();
                            c473.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m474 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f132(v0: Str, v1: bool, v2: (Str, bool)) -> bool {
    if v1 {
        true
    } else {
        let a478 = {
            let (h477, _) = v2;
            h477
        };
        let a479 = v0;
        if equal(a478, a479) {
            let a481 = {
                let (_, h480) = v2;
                h480
            };
            bool_not(a481)
        } else {
            false
        }
    }
}

pub fn f133(v0: Fn24, p485: bool, p486: List<Adt1>) -> bool {
    let m484 = (p485, p486);
    {
        let mut m484 = m484;
        loop {
            let step = {
                let (v1, v2) = m484;
                let m482 = v2;
                match m482.uncons() {
                    None => {
                        Err::<(bool, List<Adt1>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<Adt1>), bool>(({
                            let c483: Fn24 = v0.clone();
                            c483.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m484 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f134(v0: Str, v1: Adt10, v2: Str, v3: bool, v4: Adt1) -> bool {
    if v3 {
        true
    } else {
        let a488 = match v4.clone() {
            Adt1::C0(h487, _, _, _, _, _) => {
                h487
            }
        };
        let a489 = v2;
        if equal(a488, a489) {
            let a491 = match v4.clone() {
                Adt1::C0(_, h490, _, _, _, _) => {
                    h490
                }
            };
            let a492 = v0;
            if equal(a491, a492) {
                if match v4.clone() {
                    Adt1::C0(_, _, h493, _, _, _) => {
                        h493
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

pub fn f135(v0: Str, v1: Str, v2: Adt6) -> Str {
    let a497 = {
        let m496 = match v2.clone() {
            Adt6::C0(h495, _, _) => {
                h495
            }
        };
        match m496 {
            Adt7::C0(h494, _, _, _, _, _) => {
                h494
            }
        }
    };
    let a498 = v0;
    if equal(a497, a498) {
        match v2 {
            Adt6::C0(_, h499, _) => {
                h499
            }
        }
    } else {
        v1
    }
}

pub fn f136(v0: Str, v1: Str, v2: List<Bytes>, v3: (Str, Str)) -> List<Bytes> {
    let a502 = v2;
    let a503 = List::cons(f9(List::cons(Str::lit("upstream"), List::cons(v1, List::cons(v0, List::cons({
        let (h500, _) = v3;
        h500
    }, List::cons({
        let (_, h501) = v3;
        h501
    }, List::<Str>::nil())))))), List::<Bytes>::nil());
    append_list(a502, a503)
}

pub fn f137(v0: Fn25, p508: u64, p509: u64) -> R<(u64, bool)> {
    let m507 = (p508, p509);
    {
        let mut m507 = m507;
        loop {
            let step = {
                let (v1, v2) = m507;
                let m504 = v1;
                if m504 == 0 {
                    Err::<(u64, u64), R<(u64, bool)>>(Ok((v2, false)))
                } else {
                    let v3 = m504 - 1;
                    let m506 = {
                        let c505: Fn25 = v0.clone();
                        c505.apply(v2)?
                    };
                    match m506 {
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
                Ok(next) => { m507 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f138(v0: Bytes, v1: u64, v2: Bytes, v3: u64, v4: u64) -> R<Option<u64>> {
    if f139(v2, v0, v4) {
        Ok(None::<u64>)
    } else {
        let a512 = {
            let a510 = v4;
            let a511 = v1;
            nat_add(a510, a511)?
        };
        let a513 = v3;
        if nat_lt(a512, a513) {
            Ok(Some({
                let a514 = v4;
                let a515 = 1u64;
                nat_add(a514, a515)?
            }))
        } else {
            Ok(None::<u64>)
        }
    }
}

pub fn f139(v0: Bytes, v1: Bytes, v2: u64) -> bool {
    let m520 = {
        let a517 = v0;
        let a518 = v2;
        let a519 = {
            let a516 = v1.clone();
            length_bytes(a516)
        };
        slice_bytes(a517, a518, a519)
    };
    match m520 {
        None => {
            false
        }
        Some(v3) => {
            let a521 = v3;
            let a522 = v1;
            equal(a521, a522)
        }
    }
}

pub fn f140(v0: Bytes, v1: Bytes) -> bool {
    let v2: u64 = {
        let a523 = v0.clone();
        length_bytes(a523)
    };
    let v3: u64 = {
        let a524 = v1.clone();
        length_bytes(a524)
    };
    let a525 = v3;
    let a526 = v2;
    if nat_le(a525, a526) {
        let m532 = {
            let a529 = v0;
            let a530 = {
                let a527 = v2;
                let a528 = v3;
                nat_sub(a527, a528)
            };
            let a531 = v3;
            slice_bytes(a529, a530, a531)
        };
        match m532 {
            None => {
                false
            }
            Some(v4) => {
                let a533 = v4;
                let a534 = v1;
                equal(a533, a534)
            }
        }
    } else {
        false
    }
}

pub fn f141(v0: Adt7) -> Adt7 {
    Adt7::C0(match v0.clone() {
        Adt7::C0(h535, _, _, _, _, _) => {
            h535
        }
    }, match v0.clone() {
        Adt7::C0(_, h536, _, _, _, _) => {
            h536
        }
    }, Str::lit("prism"), match v0.clone() {
        Adt7::C0(_, _, _, h537, _, _) => {
            h537
        }
    }, match v0.clone() {
        Adt7::C0(_, _, _, _, h538, _) => {
            h538
        }
    }, match v0 {
        Adt7::C0(_, _, _, _, _, h539) => {
            h539
        }
    })
}

pub fn f142(p546: List<Str>, p547: List<Str>) -> bool {
    let m545 = (p546, p547);
    {
        let mut m545 = m545;
        loop {
            let step = {
                let (v0, v1) = m545;
                let m540 = v0;
                match m540.uncons() {
                    None => {
                        let m541 = v1;
                        match m541.uncons() {
                            None => {
                                Err::<(List<Str>, List<Str>), bool>(true)
                            }
                            Some((_, _)) => {
                                Err::<(List<Str>, List<Str>), bool>(false)
                            }
                        }
                    }
                    Some((v4, v5)) => {
                        let m542 = v1;
                        match m542.uncons() {
                            None => {
                                Err::<(List<Str>, List<Str>), bool>(false)
                            }
                            Some((v6, v7)) => {
                                let a543 = v4;
                                let a544 = v6;
                                if equal(a543, a544) {
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
                Ok(next) => { m545 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f143(v0: Adt13) -> Bytes {
    let a568 = f156(match v0.clone() {
        Adt13::C0(h548, _, _, _, _, _, _, _) => {
            h548
        }
    });
    let a569 = {
        let a566 = f156(match v0.clone() {
            Adt13::C0(_, h549, _, _, _, _, _, _) => {
                h549
            }
        });
        let a567 = {
            let a564 = f156(match v0.clone() {
                Adt13::C0(_, _, h550, _, _, _, _, _) => {
                    h550
                }
            });
            let a565 = {
                let a562 = f156(match v0.clone() {
                    Adt13::C0(_, _, _, h551, _, _, _, _) => {
                        h551
                    }
                });
                let a563 = {
                    let a560 = f156(match v0.clone() {
                        Adt13::C0(_, _, _, _, h552, _, _, _) => {
                            h552
                        }
                    });
                    let a561 = {
                        let a558 = f156(match v0.clone() {
                            Adt13::C0(_, _, _, _, _, h553, _, _) => {
                                h553
                            }
                        });
                        let a559 = {
                            let a556 = f156(match v0.clone() {
                                Adt13::C0(_, _, _, _, _, _, h554, _) => {
                                    h554
                                }
                            });
                            let a557 = f156(match v0 {
                                Adt13::C0(_, _, _, _, _, _, _, h555) => {
                                    h555
                                }
                            });
                            append_bytes(a556, a557)
                        };
                        append_bytes(a558, a559)
                    };
                    append_bytes(a560, a561)
                };
                append_bytes(a562, a563)
            };
            append_bytes(a564, a565)
        };
        append_bytes(a566, a567)
    };
    append_bytes(a568, a569)
}

pub fn f144(v0: Bytes) -> R<Adt13> {
    let v1: u64 = {
        let a570 = v0.clone();
        length_bytes(a570)
    };
    let v2: u64 = {
        let a576 = {
            let a573 = {
                let a571 = v1;
                let a572 = 72u64;
                nat_add(a571, a572)?
            };
            let a574 = 64u64;
            let a575 = 0u64;
            nat_quot(a573, a574, a575)
        };
        let a577 = 64u64;
        nat_mul(a576, a577)?
    };
    let (_, h578) = f157(Fn28::F158(v0, v1, v2), {
        let a579 = v2;
        let a580 = 64u64;
        let a581 = 0u64;
        nat_quot(a579, a580, a581)
    }, (0u64, f159()))?;
    Ok(h578)
}

pub fn f145(v0: List<Str>, v1: List<Bytes>, v2: (Bytes, Bytes)) -> R<List<Bytes>> {
    if f130(v0, {
        let (_, h582) = v2.clone();
        h582
    })? {
        Ok(List::cons(f29(List::cons(f56(Str::lit("file")), List::cons({
            let (h583, _) = v2;
            h583
        }, List::cons({
            let (_, h584) = v2;
            h584
        }, List::<Bytes>::nil())))), v1))
    } else {
        Ok(v1)
    }
}

pub fn f146(v0: Str, v1: List<Adt6>) -> Option<Adt6> {
    f160(Fn29::F161(v0), None::<Adt6>, v1)
}

pub fn f147(v0: Adt8) -> Str {
    let m585 = v0;
    match m585 {
        Adt8::C0 => {
            Str::lit("hermetic")
        }
        Adt8::C1 => {
            Str::lit("fetch")
        }
    }
}

pub fn f148(v0: Str, v1: List<Str>) -> Bytes {
    f6(f30(Fn6::F162(v0), List::<Bytes>::nil(), v1))
}

pub fn f149(v0: List<Adt6>) -> R<Bytes> {
    Ok(f6(f7(Fn0::F163, List::<Bytes>::nil(), v0)?))
}

pub fn f150(v0: Fn26, p589: bool, p590: List<Adt9>) -> bool {
    let m588 = (p589, p590);
    {
        let mut m588 = m588;
        loop {
            let step = {
                let (v1, v2) = m588;
                let m586 = v2;
                match m586.uncons() {
                    None => {
                        Err::<(bool, List<Adt9>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<Adt9>), bool>(({
                            let c587: Fn26 = v0.clone();
                            c587.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m588 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f151(v0: bool, v1: Adt9) -> bool {
    if v0 {
        f100(v1)
    } else {
        false
    }
}

pub fn f152(v0: Fn27, p594: Option<bool>, p595: List<(Str, bool)>) -> Option<bool> {
    let m593 = (p594, p595);
    {
        let mut m593 = m593;
        loop {
            let step = {
                let (v1, v2) = m593;
                let m591 = v2;
                match m591.uncons() {
                    None => {
                        Err::<(Option<bool>, List<(Str, bool)>), Option<bool>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<bool>, List<(Str, bool)>), Option<bool>>(({
                            let c592: Fn27 = v0.clone();
                            c592.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m593 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f153(v0: Str, v1: Option<bool>, v2: (Str, bool)) -> Option<bool> {
    let a597 = {
        let (h596, _) = v2;
        h596
    };
    let a598 = v0;
    if equal(a597, a598) {
        let m599 = v1;
        match m599 {
            None => {
                Some({
                    let (_, h601) = v2;
                    h601
                })
            }
            Some(v3) => {
                Some(if v3 {
                    true
                } else {
                    let (_, h600) = v2;
                    h600
                })
            }
        }
    } else {
        v1
    }
}

pub fn f154(v0: (Option<Bytes>, List<Bytes>), v1: Bytes) -> (Option<Bytes>, List<Bytes>) {
    let m603 = {
        let (h602, _) = v0;
        h602
    };
    match m603 {
        None => {
            (Some(v1), {
                let (_, h604) = v0;
                h604
            })
        }
        Some(v2) => {
            (None::<Bytes>, List::cons({
                let a605 = v2;
                let a606 = v1;
                append_bytes(a605, a606)
            }, {
                let (_, h607) = v0;
                h607
            }))
        }
    }
}

pub fn f155(v0: List<Str>, v1: Bytes, v2: bool) -> R<u64> {
    f164(Fn30::F165(v2, v1), 0u64, v0)
}

pub fn f156(v0: u32) -> Bytes {
    let a636 = f166({
        let a608 = f167(v0, 28u32);
        let a609 = 15u32;
        fixed_u32::bit_and(a608, a609)
    });
    let a637 = {
        let a634 = f166({
            let a610 = f167(v0, 24u32);
            let a611 = 15u32;
            fixed_u32::bit_and(a610, a611)
        });
        let a635 = {
            let a632 = f166({
                let a612 = f167(v0, 20u32);
                let a613 = 15u32;
                fixed_u32::bit_and(a612, a613)
            });
            let a633 = {
                let a630 = f166({
                    let a614 = f167(v0, 16u32);
                    let a615 = 15u32;
                    fixed_u32::bit_and(a614, a615)
                });
                let a631 = {
                    let a628 = f166({
                        let a616 = f167(v0, 12u32);
                        let a617 = 15u32;
                        fixed_u32::bit_and(a616, a617)
                    });
                    let a629 = {
                        let a626 = f166({
                            let a618 = f167(v0, 8u32);
                            let a619 = 15u32;
                            fixed_u32::bit_and(a618, a619)
                        });
                        let a627 = {
                            let a624 = f166({
                                let a620 = f167(v0, 4u32);
                                let a621 = 15u32;
                                fixed_u32::bit_and(a620, a621)
                            });
                            let a625 = f166({
                                let a622 = v0;
                                let a623 = 15u32;
                                fixed_u32::bit_and(a622, a623)
                            });
                            append_bytes(a624, a625)
                        };
                        append_bytes(a626, a627)
                    };
                    append_bytes(a628, a629)
                };
                append_bytes(a630, a631)
            };
            append_bytes(a632, a633)
        };
        append_bytes(a634, a635)
    };
    append_bytes(a636, a637)
}

pub fn f157(v0: Fn28, p641: u64, p642: (u64, Adt13)) -> R<(u64, Adt13)> {
    let m640 = (p641, p642);
    {
        let mut m640 = m640;
        loop {
            let step = {
                let (v1, v2) = m640;
                let m638 = v1;
                if m638 == 0 {
                    Err::<(u64, (u64, Adt13)), R<(u64, Adt13)>>(Ok(v2))
                } else {
                    let v3 = m638 - 1;
                    Ok::<(u64, (u64, Adt13)), R<(u64, Adt13)>>((v3, {
                        let c639: Fn28 = v0.clone();
                        c639.apply(v2)?
                    }))
                }
            };
            match step {
                Ok(next) => { m640 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f158(v0: Bytes, v1: u64, v2: u64, v3: (u64, Adt13)) -> R<(u64, Adt13)> {
    Ok(({
        let a644 = {
            let (h643, _) = v3.clone();
            h643
        };
        let a645 = 64u64;
        nat_add(a644, a645)?
    }, f168({
        let (_, h646) = v3;
        h646
    }, f169(v0, v1, v2, {
        let (h647, _) = v3;
        h647
    })?)?))
}

pub fn f159() -> Adt13 {
    Adt13::C0(1779033703u32, 3144134277u32, 1013904242u32, 2773480762u32, 1359893119u32, 2600822924u32, 528734635u32, 1541459225u32)
}

pub fn f160(v0: Fn29, p651: Option<Adt6>, p652: List<Adt6>) -> Option<Adt6> {
    let m650 = (p651, p652);
    {
        let mut m650 = m650;
        loop {
            let step = {
                let (v1, v2) = m650;
                let m648 = v2;
                match m648.uncons() {
                    None => {
                        Err::<(Option<Adt6>, List<Adt6>), Option<Adt6>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Adt6>, List<Adt6>), Option<Adt6>>(({
                            let c649: Fn29 = v0.clone();
                            c649.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m650 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f161(v0: Str, v1: Option<Adt6>, v2: Adt6) -> Option<Adt6> {
    let a656 = {
        let m655 = match v2.clone() {
            Adt6::C0(h654, _, _) => {
                h654
            }
        };
        match m655 {
            Adt7::C0(h653, _, _, _, _, _) => {
                h653
            }
        }
    };
    let a657 = v0;
    if equal(a656, a657) {
        Some(v2)
    } else {
        v1
    }
}

pub fn f162(v0: Str, v1: List<Bytes>, v2: Str) -> List<Bytes> {
    List::cons(f29(List::cons(f56(v0), List::cons(f56(v2), List::<Bytes>::nil()))), v1)
}

pub fn f163(v0: List<Bytes>, v1: Adt6) -> List<Bytes> {
    List::cons(f29(List::cons(f56(Str::lit("needs")), List::cons(f56({
        let m660 = match v1.clone() {
            Adt6::C0(h659, _, _) => {
                h659
            }
        };
        match m660 {
            Adt7::C0(h658, _, _, _, _, _) => {
                h658
            }
        }
    }), List::cons(f56(match v1 {
        Adt6::C0(_, h661, _) => {
            h661
        }
    }), List::<Bytes>::nil())))), v0)
}

pub fn f164(v0: Fn30, p665: u64, p666: List<Str>) -> R<u64> {
    let m664 = (p665, p666);
    {
        let mut m664 = m664;
        loop {
            let step = {
                let (v1, v2) = m664;
                let m662 = v2;
                match m662.uncons() {
                    None => {
                        Err::<(u64, List<Str>), R<u64>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(u64, List<Str>), R<u64>>(({
                            let c663: Fn30 = v0.clone();
                            c663.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m664 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f165(v0: bool, v1: Bytes, v2: u64, v3: Str) -> R<u64> {
    let a667 = f170(v3.clone(), Bytes::lit(&[0x21]));
    let a668 = v0;
    if equal(a667, a668) {
        let v4: u64 = f171(v3, v1)?;
        let a669 = v2;
        let a670 = v4;
        if nat_lt(a669, a670) {
            Ok(v4)
        } else {
            Ok(v2)
        }
    } else {
        Ok(v2)
    }
}

pub fn f166(v0: u32) -> Bytes {
    let a673 = {
        let a671 = v0;
        let a672 = 8u32;
        fixed_u32::bit_and(a671, a672)
    };
    let a674 = 0u32;
    if equal(a673, a674) {
        let a677 = {
            let a675 = v0;
            let a676 = 4u32;
            fixed_u32::bit_and(a675, a676)
        };
        let a678 = 0u32;
        if equal(a677, a678) {
            let a681 = {
                let a679 = v0;
                let a680 = 2u32;
                fixed_u32::bit_and(a679, a680)
            };
            let a682 = 0u32;
            if equal(a681, a682) {
                let a685 = {
                    let a683 = v0;
                    let a684 = 1u32;
                    fixed_u32::bit_and(a683, a684)
                };
                let a686 = 0u32;
                if equal(a685, a686) {
                    Bytes::lit(&[0x30])
                } else {
                    Bytes::lit(&[0x31])
                }
            } else {
                let a689 = {
                    let a687 = v0;
                    let a688 = 1u32;
                    fixed_u32::bit_and(a687, a688)
                };
                let a690 = 0u32;
                if equal(a689, a690) {
                    Bytes::lit(&[0x32])
                } else {
                    Bytes::lit(&[0x33])
                }
            }
        } else {
            let a693 = {
                let a691 = v0;
                let a692 = 2u32;
                fixed_u32::bit_and(a691, a692)
            };
            let a694 = 0u32;
            if equal(a693, a694) {
                let a697 = {
                    let a695 = v0;
                    let a696 = 1u32;
                    fixed_u32::bit_and(a695, a696)
                };
                let a698 = 0u32;
                if equal(a697, a698) {
                    Bytes::lit(&[0x34])
                } else {
                    Bytes::lit(&[0x35])
                }
            } else {
                let a701 = {
                    let a699 = v0;
                    let a700 = 1u32;
                    fixed_u32::bit_and(a699, a700)
                };
                let a702 = 0u32;
                if equal(a701, a702) {
                    Bytes::lit(&[0x36])
                } else {
                    Bytes::lit(&[0x37])
                }
            }
        }
    } else {
        let a705 = {
            let a703 = v0;
            let a704 = 4u32;
            fixed_u32::bit_and(a703, a704)
        };
        let a706 = 0u32;
        if equal(a705, a706) {
            let a709 = {
                let a707 = v0;
                let a708 = 2u32;
                fixed_u32::bit_and(a707, a708)
            };
            let a710 = 0u32;
            if equal(a709, a710) {
                let a713 = {
                    let a711 = v0;
                    let a712 = 1u32;
                    fixed_u32::bit_and(a711, a712)
                };
                let a714 = 0u32;
                if equal(a713, a714) {
                    Bytes::lit(&[0x38])
                } else {
                    Bytes::lit(&[0x39])
                }
            } else {
                let a717 = {
                    let a715 = v0;
                    let a716 = 1u32;
                    fixed_u32::bit_and(a715, a716)
                };
                let a718 = 0u32;
                if equal(a717, a718) {
                    Bytes::lit(&[0x61])
                } else {
                    Bytes::lit(&[0x62])
                }
            }
        } else {
            let a721 = {
                let a719 = v0;
                let a720 = 2u32;
                fixed_u32::bit_and(a719, a720)
            };
            let a722 = 0u32;
            if equal(a721, a722) {
                let a725 = {
                    let a723 = v0;
                    let a724 = 1u32;
                    fixed_u32::bit_and(a723, a724)
                };
                let a726 = 0u32;
                if equal(a725, a726) {
                    Bytes::lit(&[0x63])
                } else {
                    Bytes::lit(&[0x64])
                }
            } else {
                let a729 = {
                    let a727 = v0;
                    let a728 = 1u32;
                    fixed_u32::bit_and(a727, a728)
                };
                let a730 = 0u32;
                if equal(a729, a730) {
                    Bytes::lit(&[0x65])
                } else {
                    Bytes::lit(&[0x66])
                }
            }
        }
    }
}

pub fn f167(v0: u32, v1: u32) -> u32 {
    let m733 = {
        let a731 = v0;
        let a732 = v1;
        fixed_u32::shift_right(a731, a732)
    };
    match m733 {
        None => {
            0u32
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f168(v0: Adt13, v1: Adt14) -> R<Adt13> {
    let v2: Adt15 = f172(Fn31::F173, 64u64, Adt15::C0(match v0.clone() {
        Adt13::C0(h734, _, _, _, _, _, _, _) => {
            h734
        }
    }, match v0.clone() {
        Adt13::C0(_, h735, _, _, _, _, _, _) => {
            h735
        }
    }, match v0.clone() {
        Adt13::C0(_, _, h736, _, _, _, _, _) => {
            h736
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, h737, _, _, _, _) => {
            h737
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, h738, _, _, _) => {
            h738
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, h739, _, _) => {
            h739
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, h740, _) => {
            h740
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, h741) => {
            h741
        }
    }, v1, 0u64))?;
    Ok(Adt13::C0(f174(match v0.clone() {
        Adt13::C0(h742, _, _, _, _, _, _, _) => {
            h742
        }
    }, match v2.clone() {
        Adt15::C0(h743, _, _, _, _, _, _, _, _, _) => {
            h743
        }
    }), f174(match v0.clone() {
        Adt13::C0(_, h744, _, _, _, _, _, _) => {
            h744
        }
    }, match v2.clone() {
        Adt15::C0(_, h745, _, _, _, _, _, _, _, _) => {
            h745
        }
    }), f174(match v0.clone() {
        Adt13::C0(_, _, h746, _, _, _, _, _) => {
            h746
        }
    }, match v2.clone() {
        Adt15::C0(_, _, h747, _, _, _, _, _, _, _) => {
            h747
        }
    }), f174(match v0.clone() {
        Adt13::C0(_, _, _, h748, _, _, _, _) => {
            h748
        }
    }, match v2.clone() {
        Adt15::C0(_, _, _, h749, _, _, _, _, _, _) => {
            h749
        }
    }), f174(match v0.clone() {
        Adt13::C0(_, _, _, _, h750, _, _, _) => {
            h750
        }
    }, match v2.clone() {
        Adt15::C0(_, _, _, _, h751, _, _, _, _, _) => {
            h751
        }
    }), f174(match v0.clone() {
        Adt13::C0(_, _, _, _, _, h752, _, _) => {
            h752
        }
    }, match v2.clone() {
        Adt15::C0(_, _, _, _, _, h753, _, _, _, _) => {
            h753
        }
    }), f174(match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, h754, _) => {
            h754
        }
    }, match v2.clone() {
        Adt15::C0(_, _, _, _, _, _, h755, _, _, _) => {
            h755
        }
    }), f174(match v0 {
        Adt13::C0(_, _, _, _, _, _, _, h756) => {
            h756
        }
    }, match v2 {
        Adt15::C0(_, _, _, _, _, _, _, h757, _, _) => {
            h757
        }
    })))
}

pub fn f169(v0: Bytes, v1: u64, v2: u64, v3: u64) -> R<Adt14> {
    Ok(Adt14::C0(f175(v0.clone(), v1, v2, v3)?, f175(v0.clone(), v1, v2, {
        let a758 = v3;
        let a759 = 4u64;
        nat_add(a758, a759)?
    })?, f175(v0.clone(), v1, v2, {
        let a760 = v3;
        let a761 = 8u64;
        nat_add(a760, a761)?
    })?, f175(v0.clone(), v1, v2, {
        let a762 = v3;
        let a763 = 12u64;
        nat_add(a762, a763)?
    })?, f175(v0.clone(), v1, v2, {
        let a764 = v3;
        let a765 = 16u64;
        nat_add(a764, a765)?
    })?, f175(v0.clone(), v1, v2, {
        let a766 = v3;
        let a767 = 20u64;
        nat_add(a766, a767)?
    })?, f175(v0.clone(), v1, v2, {
        let a768 = v3;
        let a769 = 24u64;
        nat_add(a768, a769)?
    })?, f175(v0.clone(), v1, v2, {
        let a770 = v3;
        let a771 = 28u64;
        nat_add(a770, a771)?
    })?, f175(v0.clone(), v1, v2, {
        let a772 = v3;
        let a773 = 32u64;
        nat_add(a772, a773)?
    })?, f175(v0.clone(), v1, v2, {
        let a774 = v3;
        let a775 = 36u64;
        nat_add(a774, a775)?
    })?, f175(v0.clone(), v1, v2, {
        let a776 = v3;
        let a777 = 40u64;
        nat_add(a776, a777)?
    })?, f175(v0.clone(), v1, v2, {
        let a778 = v3;
        let a779 = 44u64;
        nat_add(a778, a779)?
    })?, f175(v0.clone(), v1, v2, {
        let a780 = v3;
        let a781 = 48u64;
        nat_add(a780, a781)?
    })?, f175(v0.clone(), v1, v2, {
        let a782 = v3;
        let a783 = 52u64;
        nat_add(a782, a783)?
    })?, f175(v0.clone(), v1, v2, {
        let a784 = v3;
        let a785 = 56u64;
        nat_add(a784, a785)?
    })?, f175(v0, v1, v2, {
        let a786 = v3;
        let a787 = 60u64;
        nat_add(a786, a787)?
    })?))
}

pub fn f170(v0: Str, v1: Bytes) -> bool {
    f176(f56(v0), v1)
}

pub fn f171(v0: Str, v1: Bytes) -> R<u64> {
    let v2: Bytes = if f170(v0.clone(), Bytes::lit(&[0x21])) {
        f177(v0)
    } else {
        f56(v0)
    };
    if f176(v1.clone(), v2.clone()) {
        if f176(v1, Bytes::lit(&[0x40])) {
            if f176(v2.clone(), Bytes::lit(&[0x40])) {
                let a789 = {
                    let a788 = v2;
                    length_bytes(a788)
                };
                let a790 = 1u64;
                nat_add(a789, a790)
            } else {
                Ok(0u64)
            }
        } else {
            let a792 = {
                let a791 = v2;
                length_bytes(a791)
            };
            let a793 = 1u64;
            nat_add(a792, a793)
        }
    } else {
        Ok(0u64)
    }
}

pub fn f172(v0: Fn31, p797: u64, p798: Adt15) -> R<Adt15> {
    let m796 = (p797, p798);
    {
        let mut m796 = m796;
        loop {
            let step = {
                let (v1, v2) = m796;
                let m794 = v1;
                if m794 == 0 {
                    Err::<(u64, Adt15), R<Adt15>>(Ok(v2))
                } else {
                    let v3 = m794 - 1;
                    Ok::<(u64, Adt15), R<Adt15>>((v3, {
                        let c795: Fn31 = v0.clone();
                        c795.apply(v2)?
                    }))
                }
            };
            match step {
                Ok(next) => { m796 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f173(v0: Adt15) -> R<Adt15> {
    f178(v0)
}

pub fn f174(v0: u32, v1: u32) -> u32 {
    let m801 = {
        let a799 = f179(v0);
        let a800 = f179(v1);
        fixed_u64::checked_add(a799, a800)
    };
    match m801 {
        None => {
            0u32
        }
        Some(v2) => {
            f180(v2)
        }
    }
}

pub fn f175(v0: Bytes, v1: u64, v2: u64, v3: u64) -> R<u32> {
    let a804 = {
        let a802 = v3;
        let a803 = 8u64;
        nat_add(a802, a803)?
    };
    let a805 = v2;
    if nat_eq(a804, a805) {
        Ok(f181({
            let a808 = {
                let a806 = v1;
                let a807 = 8u64;
                nat_mul(a806, a807)?
            };
            let a809 = 4294967296u64;
            let a810 = 0u64;
            nat_quot(a808, a809, a810)
        }))
    } else {
        let a813 = {
            let a811 = v3;
            let a812 = 4u64;
            nat_add(a811, a812)?
        };
        let a814 = v2;
        if nat_eq(a813, a814) {
            Ok(f181({
                let a817 = {
                    let a815 = v1;
                    let a816 = 8u64;
                    nat_mul(a815, a816)?
                };
                let a818 = 4294967296u64;
                let a819 = 0u64;
                nat_rem(a817, a818, a819)
            }))
        } else {
            Ok(f182(f183(v0.clone(), v1, v3), f183(v0.clone(), v1, {
                let a820 = v3;
                let a821 = 1u64;
                nat_add(a820, a821)?
            }), f183(v0.clone(), v1, {
                let a822 = v3;
                let a823 = 2u64;
                nat_add(a822, a823)?
            }), f183(v0, v1, {
                let a824 = v3;
                let a825 = 3u64;
                nat_add(a824, a825)?
            })))
        }
    }
}

pub fn f176(v0: Bytes, v1: Bytes) -> bool {
    let m830 = {
        let a827 = v0;
        let a828 = 0u64;
        let a829 = {
            let a826 = v1.clone();
            length_bytes(a826)
        };
        slice_bytes(a827, a828, a829)
    };
    match m830 {
        None => {
            false
        }
        Some(v2) => {
            let a831 = v2;
            let a832 = v1;
            equal(a831, a832)
        }
    }
}

pub fn f177(v0: Str) -> Bytes {
    let v1: Bytes = f56(v0);
    f37(v1.clone(), 1u64, {
        let a834 = {
            let a833 = v1;
            length_bytes(a833)
        };
        let a835 = 1u64;
        nat_sub(a834, a835)
    })
}

pub fn f178(v0: Adt15) -> R<Adt15> {
    let v1: u32 = f184(match v0.clone() {
        Adt15::C0(_, _, _, _, _, _, _, _, _, h836) => {
            h836
        }
    });
    let v2: u32 = f174(match v0.clone() {
        Adt15::C0(_, _, _, _, _, _, _, h837, _, _) => {
            h837
        }
    }, f174(f185(match v0.clone() {
        Adt15::C0(_, _, _, _, h838, _, _, _, _, _) => {
            h838
        }
    }), f174(f186(match v0.clone() {
        Adt15::C0(_, _, _, _, h839, _, _, _, _, _) => {
            h839
        }
    }, match v0.clone() {
        Adt15::C0(_, _, _, _, _, h840, _, _, _, _) => {
            h840
        }
    }, match v0.clone() {
        Adt15::C0(_, _, _, _, _, _, h841, _, _, _) => {
            h841
        }
    }), f174(v1, {
        let m844 = match v0.clone() {
            Adt15::C0(_, _, _, _, _, _, _, _, h843, _) => {
                h843
            }
        };
        match m844 {
            Adt14::C0(h842, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h842
            }
        }
    }))));
    let v3: u32 = f174(f187(match v0.clone() {
        Adt15::C0(h845, _, _, _, _, _, _, _, _, _) => {
            h845
        }
    }), f188(match v0.clone() {
        Adt15::C0(h846, _, _, _, _, _, _, _, _, _) => {
            h846
        }
    }, match v0.clone() {
        Adt15::C0(_, h847, _, _, _, _, _, _, _, _) => {
            h847
        }
    }, match v0.clone() {
        Adt15::C0(_, _, h848, _, _, _, _, _, _, _) => {
            h848
        }
    }));
    Ok(Adt15::C0(f174(v2, v3), match v0.clone() {
        Adt15::C0(h849, _, _, _, _, _, _, _, _, _) => {
            h849
        }
    }, match v0.clone() {
        Adt15::C0(_, h850, _, _, _, _, _, _, _, _) => {
            h850
        }
    }, match v0.clone() {
        Adt15::C0(_, _, h851, _, _, _, _, _, _, _) => {
            h851
        }
    }, f174(match v0.clone() {
        Adt15::C0(_, _, _, h852, _, _, _, _, _, _) => {
            h852
        }
    }, v2), match v0.clone() {
        Adt15::C0(_, _, _, _, h853, _, _, _, _, _) => {
            h853
        }
    }, match v0.clone() {
        Adt15::C0(_, _, _, _, _, h854, _, _, _, _) => {
            h854
        }
    }, match v0.clone() {
        Adt15::C0(_, _, _, _, _, _, h855, _, _, _) => {
            h855
        }
    }, f189(match v0.clone() {
        Adt15::C0(_, _, _, _, _, _, _, _, h856, _) => {
            h856
        }
    }), {
        let a858 = match v0 {
            Adt15::C0(_, _, _, _, _, _, _, _, _, h857) => {
                h857
            }
        };
        let a859 = 1u64;
        nat_add(a858, a859)?
    }))
}

pub fn f179(v0: u32) -> u64 {
    let m861 = {
        let a860 = v0;
        fixed_u64::convert(i128::from(a860))
    };
    match m861 {
        None => {
            0u64
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f180(v0: u64) -> u32 {
    let m865 = {
        let a864 = {
            let a862 = v0;
            let a863 = 4294967295u64;
            fixed_u64::bit_and(a862, a863)
        };
        fixed_u32::convert(i128::from(a864))
    };
    match m865 {
        None => {
            0u32
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f181(v0: u64) -> u32 {
    let (_, h866) = {
        let (_, h867) = f190(Fn32::F191, 32u64, (v0, (1u32, 0u32)));
        h867
    };
    h866
}

pub fn f182(v0: u32, v1: u32, v2: u32, v3: u32) -> u32 {
    let a872 = f192(v0, 24u32);
    let a873 = {
        let a870 = f192(v1, 16u32);
        let a871 = {
            let a868 = f192(v2, 8u32);
            let a869 = v3;
            fixed_u32::bit_or(a868, a869)
        };
        fixed_u32::bit_or(a870, a871)
    };
    fixed_u32::bit_or(a872, a873)
}

pub fn f183(v0: Bytes, v1: u64, v2: u64) -> u32 {
    let a874 = v2;
    let a875 = v1;
    if nat_lt(a874, a875) {
        let m878 = {
            let a876 = v0;
            let a877 = v2;
            index_bytes(a876, a877)
        };
        match m878 {
            None => {
                0u32
            }
            Some(v3) => {
                let m880 = {
                    let a879 = v3;
                    fixed_u32::convert(i128::from(a879))
                };
                match m880 {
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
        let a881 = v2;
        let a882 = v1;
        if nat_eq(a881, a882) {
            128u32
        } else {
            0u32
        }
    }
}

pub fn f184(v0: u64) -> u32 {
    let a883 = v0;
    let a884 = 32u64;
    if nat_lt(a883, a884) {
        let a885 = v0;
        let a886 = 16u64;
        if nat_lt(a885, a886) {
            let a887 = v0;
            let a888 = 8u64;
            if nat_lt(a887, a888) {
                let a889 = v0;
                let a890 = 4u64;
                if nat_lt(a889, a890) {
                    let a891 = v0;
                    let a892 = 2u64;
                    if nat_lt(a891, a892) {
                        let a893 = v0;
                        let a894 = 1u64;
                        if nat_lt(a893, a894) {
                            1116352408u32
                        } else {
                            1899447441u32
                        }
                    } else {
                        let a895 = v0;
                        let a896 = 3u64;
                        if nat_lt(a895, a896) {
                            3049323471u32
                        } else {
                            3921009573u32
                        }
                    }
                } else {
                    let a897 = v0;
                    let a898 = 6u64;
                    if nat_lt(a897, a898) {
                        let a899 = v0;
                        let a900 = 5u64;
                        if nat_lt(a899, a900) {
                            961987163u32
                        } else {
                            1508970993u32
                        }
                    } else {
                        let a901 = v0;
                        let a902 = 7u64;
                        if nat_lt(a901, a902) {
                            2453635748u32
                        } else {
                            2870763221u32
                        }
                    }
                }
            } else {
                let a903 = v0;
                let a904 = 12u64;
                if nat_lt(a903, a904) {
                    let a905 = v0;
                    let a906 = 10u64;
                    if nat_lt(a905, a906) {
                        let a907 = v0;
                        let a908 = 9u64;
                        if nat_lt(a907, a908) {
                            3624381080u32
                        } else {
                            310598401u32
                        }
                    } else {
                        let a909 = v0;
                        let a910 = 11u64;
                        if nat_lt(a909, a910) {
                            607225278u32
                        } else {
                            1426881987u32
                        }
                    }
                } else {
                    let a911 = v0;
                    let a912 = 14u64;
                    if nat_lt(a911, a912) {
                        let a913 = v0;
                        let a914 = 13u64;
                        if nat_lt(a913, a914) {
                            1925078388u32
                        } else {
                            2162078206u32
                        }
                    } else {
                        let a915 = v0;
                        let a916 = 15u64;
                        if nat_lt(a915, a916) {
                            2614888103u32
                        } else {
                            3248222580u32
                        }
                    }
                }
            }
        } else {
            let a917 = v0;
            let a918 = 24u64;
            if nat_lt(a917, a918) {
                let a919 = v0;
                let a920 = 20u64;
                if nat_lt(a919, a920) {
                    let a921 = v0;
                    let a922 = 18u64;
                    if nat_lt(a921, a922) {
                        let a923 = v0;
                        let a924 = 17u64;
                        if nat_lt(a923, a924) {
                            3835390401u32
                        } else {
                            4022224774u32
                        }
                    } else {
                        let a925 = v0;
                        let a926 = 19u64;
                        if nat_lt(a925, a926) {
                            264347078u32
                        } else {
                            604807628u32
                        }
                    }
                } else {
                    let a927 = v0;
                    let a928 = 22u64;
                    if nat_lt(a927, a928) {
                        let a929 = v0;
                        let a930 = 21u64;
                        if nat_lt(a929, a930) {
                            770255983u32
                        } else {
                            1249150122u32
                        }
                    } else {
                        let a931 = v0;
                        let a932 = 23u64;
                        if nat_lt(a931, a932) {
                            1555081692u32
                        } else {
                            1996064986u32
                        }
                    }
                }
            } else {
                let a933 = v0;
                let a934 = 28u64;
                if nat_lt(a933, a934) {
                    let a935 = v0;
                    let a936 = 26u64;
                    if nat_lt(a935, a936) {
                        let a937 = v0;
                        let a938 = 25u64;
                        if nat_lt(a937, a938) {
                            2554220882u32
                        } else {
                            2821834349u32
                        }
                    } else {
                        let a939 = v0;
                        let a940 = 27u64;
                        if nat_lt(a939, a940) {
                            2952996808u32
                        } else {
                            3210313671u32
                        }
                    }
                } else {
                    let a941 = v0;
                    let a942 = 30u64;
                    if nat_lt(a941, a942) {
                        let a943 = v0;
                        let a944 = 29u64;
                        if nat_lt(a943, a944) {
                            3336571891u32
                        } else {
                            3584528711u32
                        }
                    } else {
                        let a945 = v0;
                        let a946 = 31u64;
                        if nat_lt(a945, a946) {
                            113926993u32
                        } else {
                            338241895u32
                        }
                    }
                }
            }
        }
    } else {
        let a947 = v0;
        let a948 = 48u64;
        if nat_lt(a947, a948) {
            let a949 = v0;
            let a950 = 40u64;
            if nat_lt(a949, a950) {
                let a951 = v0;
                let a952 = 36u64;
                if nat_lt(a951, a952) {
                    let a953 = v0;
                    let a954 = 34u64;
                    if nat_lt(a953, a954) {
                        let a955 = v0;
                        let a956 = 33u64;
                        if nat_lt(a955, a956) {
                            666307205u32
                        } else {
                            773529912u32
                        }
                    } else {
                        let a957 = v0;
                        let a958 = 35u64;
                        if nat_lt(a957, a958) {
                            1294757372u32
                        } else {
                            1396182291u32
                        }
                    }
                } else {
                    let a959 = v0;
                    let a960 = 38u64;
                    if nat_lt(a959, a960) {
                        let a961 = v0;
                        let a962 = 37u64;
                        if nat_lt(a961, a962) {
                            1695183700u32
                        } else {
                            1986661051u32
                        }
                    } else {
                        let a963 = v0;
                        let a964 = 39u64;
                        if nat_lt(a963, a964) {
                            2177026350u32
                        } else {
                            2456956037u32
                        }
                    }
                }
            } else {
                let a965 = v0;
                let a966 = 44u64;
                if nat_lt(a965, a966) {
                    let a967 = v0;
                    let a968 = 42u64;
                    if nat_lt(a967, a968) {
                        let a969 = v0;
                        let a970 = 41u64;
                        if nat_lt(a969, a970) {
                            2730485921u32
                        } else {
                            2820302411u32
                        }
                    } else {
                        let a971 = v0;
                        let a972 = 43u64;
                        if nat_lt(a971, a972) {
                            3259730800u32
                        } else {
                            3345764771u32
                        }
                    }
                } else {
                    let a973 = v0;
                    let a974 = 46u64;
                    if nat_lt(a973, a974) {
                        let a975 = v0;
                        let a976 = 45u64;
                        if nat_lt(a975, a976) {
                            3516065817u32
                        } else {
                            3600352804u32
                        }
                    } else {
                        let a977 = v0;
                        let a978 = 47u64;
                        if nat_lt(a977, a978) {
                            4094571909u32
                        } else {
                            275423344u32
                        }
                    }
                }
            }
        } else {
            let a979 = v0;
            let a980 = 56u64;
            if nat_lt(a979, a980) {
                let a981 = v0;
                let a982 = 52u64;
                if nat_lt(a981, a982) {
                    let a983 = v0;
                    let a984 = 50u64;
                    if nat_lt(a983, a984) {
                        let a985 = v0;
                        let a986 = 49u64;
                        if nat_lt(a985, a986) {
                            430227734u32
                        } else {
                            506948616u32
                        }
                    } else {
                        let a987 = v0;
                        let a988 = 51u64;
                        if nat_lt(a987, a988) {
                            659060556u32
                        } else {
                            883997877u32
                        }
                    }
                } else {
                    let a989 = v0;
                    let a990 = 54u64;
                    if nat_lt(a989, a990) {
                        let a991 = v0;
                        let a992 = 53u64;
                        if nat_lt(a991, a992) {
                            958139571u32
                        } else {
                            1322822218u32
                        }
                    } else {
                        let a993 = v0;
                        let a994 = 55u64;
                        if nat_lt(a993, a994) {
                            1537002063u32
                        } else {
                            1747873779u32
                        }
                    }
                }
            } else {
                let a995 = v0;
                let a996 = 60u64;
                if nat_lt(a995, a996) {
                    let a997 = v0;
                    let a998 = 58u64;
                    if nat_lt(a997, a998) {
                        let a999 = v0;
                        let a1000 = 57u64;
                        if nat_lt(a999, a1000) {
                            1955562222u32
                        } else {
                            2024104815u32
                        }
                    } else {
                        let a1001 = v0;
                        let a1002 = 59u64;
                        if nat_lt(a1001, a1002) {
                            2227730452u32
                        } else {
                            2361852424u32
                        }
                    }
                } else {
                    let a1003 = v0;
                    let a1004 = 62u64;
                    if nat_lt(a1003, a1004) {
                        let a1005 = v0;
                        let a1006 = 61u64;
                        if nat_lt(a1005, a1006) {
                            2428436474u32
                        } else {
                            2756734187u32
                        }
                    } else {
                        let a1007 = v0;
                        let a1008 = 63u64;
                        if nat_lt(a1007, a1008) {
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

pub fn f185(v0: u32) -> u32 {
    let a1011 = {
        let a1009 = f193(v0, 6u32, 26u32);
        let a1010 = f193(v0, 11u32, 21u32);
        fixed_u32::bit_xor(a1009, a1010)
    };
    let a1012 = f193(v0, 25u32, 7u32);
    fixed_u32::bit_xor(a1011, a1012)
}

pub fn f186(v0: u32, v1: u32, v2: u32) -> u32 {
    let a1018 = {
        let a1013 = v0;
        let a1014 = v1;
        fixed_u32::bit_and(a1013, a1014)
    };
    let a1019 = {
        let a1016 = {
            let a1015 = v0;
            fixed_u32::bit_not(a1015)
        };
        let a1017 = v2;
        fixed_u32::bit_and(a1016, a1017)
    };
    fixed_u32::bit_xor(a1018, a1019)
}

pub fn f187(v0: u32) -> u32 {
    let a1022 = {
        let a1020 = f193(v0, 2u32, 30u32);
        let a1021 = f193(v0, 13u32, 19u32);
        fixed_u32::bit_xor(a1020, a1021)
    };
    let a1023 = f193(v0, 22u32, 10u32);
    fixed_u32::bit_xor(a1022, a1023)
}

pub fn f188(v0: u32, v1: u32, v2: u32) -> u32 {
    let a1032 = {
        let a1028 = {
            let a1024 = v0;
            let a1025 = v1;
            fixed_u32::bit_and(a1024, a1025)
        };
        let a1029 = {
            let a1026 = v0;
            let a1027 = v2;
            fixed_u32::bit_and(a1026, a1027)
        };
        fixed_u32::bit_xor(a1028, a1029)
    };
    let a1033 = {
        let a1030 = v1;
        let a1031 = v2;
        fixed_u32::bit_and(a1030, a1031)
    };
    fixed_u32::bit_xor(a1032, a1033)
}

pub fn f189(v0: Adt14) -> Adt14 {
    Adt14::C0(match v0.clone() {
        Adt14::C0(_, h1034, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h1034
        }
    }, match v0.clone() {
        Adt14::C0(_, _, h1035, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h1035
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, h1036, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h1036
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, h1037, _, _, _, _, _, _, _, _, _, _, _) => {
            h1037
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, h1038, _, _, _, _, _, _, _, _, _, _) => {
            h1038
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, h1039, _, _, _, _, _, _, _, _, _) => {
            h1039
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, h1040, _, _, _, _, _, _, _, _) => {
            h1040
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, h1041, _, _, _, _, _, _, _) => {
            h1041
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, h1042, _, _, _, _, _, _) => {
            h1042
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, h1043, _, _, _, _, _) => {
            h1043
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, h1044, _, _, _, _) => {
            h1044
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, _, h1045, _, _, _) => {
            h1045
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, h1046, _, _) => {
            h1046
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h1047, _) => {
            h1047
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h1048) => {
            h1048
        }
    }, f174(f194(match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h1049, _) => {
            h1049
        }
    }), f174(match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, h1050, _, _, _, _, _, _) => {
            h1050
        }
    }, f174(f195(match v0.clone() {
        Adt14::C0(_, h1051, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h1051
        }
    }), match v0 {
        Adt14::C0(h1052, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h1052
        }
    }))))
}

pub fn f190(v0: Fn32, p1056: u64, p1057: (u64, (u32, u32))) -> (u64, (u32, u32)) {
    let m1055 = (p1056, p1057);
    {
        let mut m1055 = m1055;
        loop {
            let step = {
                let (v1, v2) = m1055;
                let m1053 = v1;
                if m1053 == 0 {
                    Err::<(u64, (u64, (u32, u32))), (u64, (u32, u32))>(v2)
                } else {
                    let v3 = m1053 - 1;
                    Ok::<(u64, (u64, (u32, u32))), (u64, (u32, u32))>((v3, {
                        let c1054: Fn32 = v0.clone();
                        c1054.apply(v2)
                    }))
                }
            };
            match step {
                Ok(next) => { m1055 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f191(v0: (u64, (u32, u32))) -> (u64, (u32, u32)) {
    let v1: u64 = {
        let (h1058, _) = v0;
        h1058
    };
    let v2: u32 = {
        let (h1059, _) = {
            let (_, h1060) = v0;
            h1060
        };
        h1059
    };
    let v3: u32 = {
        let (_, h1061) = {
            let (_, h1062) = v0;
            h1062
        };
        h1061
    };
    ({
        let a1063 = v1;
        let a1064 = 2u64;
        let a1065 = 0u64;
        nat_quot(a1063, a1064, a1065)
    }, (f192(v2, 1u32), {
        let a1069 = {
            let a1066 = v1;
            let a1067 = 2u64;
            let a1068 = 0u64;
            nat_rem(a1066, a1067, a1068)
        };
        let a1070 = 1u64;
        if nat_eq(a1069, a1070) {
            let a1071 = v3;
            let a1072 = v2;
            fixed_u32::bit_or(a1071, a1072)
        } else {
            v3
        }
    }))
}

pub fn f192(v0: u32, v1: u32) -> u32 {
    let m1075 = {
        let a1073 = v0;
        let a1074 = v1;
        fixed_u32::shift_left(a1073, a1074)
    };
    match m1075 {
        None => {
            0u32
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f193(v0: u32, v1: u32, v2: u32) -> u32 {
    let a1076 = f167(v0, v1);
    let a1077 = f192(v0, v2);
    fixed_u32::bit_or(a1076, a1077)
}

pub fn f194(v0: u32) -> u32 {
    let a1080 = {
        let a1078 = f193(v0, 17u32, 15u32);
        let a1079 = f193(v0, 19u32, 13u32);
        fixed_u32::bit_xor(a1078, a1079)
    };
    let a1081 = f167(v0, 10u32);
    fixed_u32::bit_xor(a1080, a1081)
}

pub fn f195(v0: u32) -> u32 {
    let a1084 = {
        let a1082 = f193(v0, 7u32, 25u32);
        let a1083 = f193(v0, 18u32, 14u32);
        fixed_u32::bit_xor(a1082, a1083)
    };
    let a1085 = f167(v0, 3u32);
    fixed_u32::bit_xor(a1084, a1085)
}
