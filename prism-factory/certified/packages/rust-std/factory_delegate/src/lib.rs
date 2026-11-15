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
    C0(List<(Bytes, Bytes)>, List<Adt1>, Str, List<Str>, Adt4),
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
    C0(Adt6, Str, Adt8),
}

#[derive(Clone)]
pub enum Adt6 {
    C0(Str, Adt7, Str, Str, List<Str>, List<Str>),
}

#[derive(Clone)]
pub enum Adt7 {
    C0,
    C1,
}

#[derive(Clone)]
pub enum Adt8 {
    C0,
    C1,
    C2,
    C3,
}

#[derive(Clone)]
pub enum Adt9 {
    C0(Str, List<Str>),
}

#[derive(Clone)]
pub enum Adt10 {
    C0(Str, Str, Str, Str, Str, Adt11),
}

#[derive(Clone)]
pub enum Adt11 {
    C0,
    C1,
    C2,
}

#[derive(Clone)]
pub enum Adt12 {
    C0(u32, u32, u32, u32, u32, u32, u32, u32),
}

#[derive(Clone)]
pub enum Adt13 {
    C0(u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32, u32),
}

#[derive(Clone)]
pub enum Adt14 {
    C0(u32, u32, u32, u32, u32, u32, u32, u32, Adt13, u64),
}

#[derive(Clone)]
pub enum Fn0 {
    F8(Adt0, List<Str>),
    F140,
}

impl Fn0 {
    pub fn apply(&self, p0: List<Bytes>, p1: Adt5) -> R<List<Bytes>> {
        match self {
            Fn0::F8(k0, k1) => f8(k0.clone(), k1.clone(), p0, p1),
            Fn0::F140 => Ok(f140(p0, p1)),
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
    F20(List<(Str, bool)>, List<(Bytes, Bytes)>),
}

impl Fn3 {
    pub fn apply(&self, p0: (List<Adt5>, List<(List<Str>, Str)>), p1: Adt6) -> R<(List<Adt5>, List<(List<Str>, Str)>)> {
        match self {
            Fn3::F20(k0, k1) => f20(k0.clone(), k1.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn4 {
    F22,
    F80,
}

impl Fn4 {
    pub fn apply(&self, p0: List<Adt6>, p1: Adt6) -> List<Adt6> {
        match self {
            Fn4::F22 => f22(p0, p1),
            Fn4::F80 => f80(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn5 {
    F25(Adt9),
}

impl Fn5 {
    pub fn apply(&self, p0: List<(Str, bool)>, p1: Adt1) -> List<(Str, bool)> {
        match self {
            Fn5::F25(k0) => f25(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn6 {
    F31,
    F139(Str),
}

impl Fn6 {
    pub fn apply(&self, p0: List<Bytes>, p1: Str) -> List<Bytes> {
        match self {
            Fn6::F31 => f31(p0, p1),
            Fn6::F139(k0) => f139(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn7 {
    F33(List<Str>),
}

impl Fn7 {
    pub fn apply(&self, p0: Str, p1: Adt5) -> Str {
        match self {
            Fn7::F33(k0) => f33(k0.clone(), p0, p1),
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
    F71,
    F72,
}

impl Fn12 {
    pub fn apply(&self, p0: List<Str>, p1: Adt6) -> List<Str> {
        match self {
            Fn12::F71 => f71(p0, p1),
            Fn12::F72 => f72(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn13 {
    F84(Str),
}

impl Fn13 {
    pub fn apply(&self, p0: Adt10, p1: (Str, Adt10)) -> Adt10 {
        match self {
            Fn13::F84(k0) => f84(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn14 {
    F89(Str),
    F106(List<Adt5>),
}

impl Fn14 {
    pub fn apply(&self, p0: bool, p1: Str) -> bool {
        match self {
            Fn14::F89(k0) => f89(k0.clone(), p0, p1),
            Fn14::F106(k0) => f106(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn15 {
    F91(List<Str>, Str),
    F122(List<Str>),
}

impl Fn15 {
    pub fn apply(&self, p0: List<Bytes>, p1: (Bytes, Bytes)) -> R<List<Bytes>> {
        match self {
            Fn15::F91(k0, k1) => f91(k0.clone(), k1.clone(), p0, p1),
            Fn15::F122(k0) => f122(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn16 {
    F94(Bytes),
}

impl Fn16 {
    pub fn apply(&self, p0: Option<Bytes>, p1: Bytes) -> Option<Bytes> {
        match self {
            Fn16::F94(k0) => f94(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn17 {
    F100(List<Str>),
}

impl Fn17 {
    pub fn apply(&self, p0: Option<Str>, p1: (List<Str>, Str)) -> Option<Str> {
        match self {
            Fn17::F100(k0) => f100(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn18 {
    F104(List<Adt5>),
}

impl Fn18 {
    pub fn apply(&self, p0: List<Adt5>, p1: Str) -> List<Adt5> {
        match self {
            Fn18::F104(k0) => f104(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn19 {
    F108,
}

impl Fn19 {
    pub fn apply(&self, p0: List<Adt8>, p1: Adt5) -> List<Adt8> {
        match self {
            Fn19::F108 => f108(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn20 {
    F113,
}

impl Fn20 {
    pub fn apply(&self, p0: (Option<Bytes>, List<Bytes>), p1: Bytes) -> (Option<Bytes>, List<Bytes>) {
        match self {
            Fn20::F113 => f113(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn21 {
    F116(Bytes, u64, Bytes, u64),
}

impl Fn21 {
    pub fn apply(&self, p0: u64) -> R<Option<u64>> {
        match self {
            Fn21::F116(k0, k1, k2, k3) => f116(k0.clone(), *k1, k2.clone(), *k3, p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn22 {
    F128,
}

impl Fn22 {
    pub fn apply(&self, p0: bool, p1: Adt8) -> bool {
        match self {
            Fn22::F128 => f128(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn23 {
    F130(Str),
}

impl Fn23 {
    pub fn apply(&self, p0: Option<bool>, p1: (Str, bool)) -> Option<bool> {
        match self {
            Fn23::F130(k0) => f130(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn24 {
    F135(Bytes, u64, u64),
}

impl Fn24 {
    pub fn apply(&self, p0: (u64, Adt12)) -> R<(u64, Adt12)> {
        match self {
            Fn24::F135(k0, k1, k2) => f135(k0.clone(), *k1, *k2, p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn25 {
    F138(Str),
}

impl Fn25 {
    pub fn apply(&self, p0: Option<Adt5>, p1: Adt5) -> Option<Adt5> {
        match self {
            Fn25::F138(k0) => f138(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn26 {
    F142(bool, Bytes),
}

impl Fn26 {
    pub fn apply(&self, p0: u64, p1: Str) -> R<u64> {
        match self {
            Fn26::F142(k0, k1) => f142(*k0, k1.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn27 {
    F150,
}

impl Fn27 {
    pub fn apply(&self, p0: Adt14) -> R<Adt14> {
        match self {
            Fn27::F150 => f150(p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn28 {
    F168,
}

impl Fn28 {
    pub fn apply(&self, p0: (u64, (u32, u32))) -> (u64, (u32, u32)) {
        match self {
            Fn28::F168 => f168(p0),
        }
    }
}

pub fn f0(v0: Bytes) -> R<Bytes> {
    let v1: Adt0 = f1(v0)?;
    let v2: List<Str> = f2(match v1.clone() {
        Adt0::C0(_, _, _, _, h1) => {
            h1
        }
    });
    let v3: List<Adt5> = f3(f4(), match v1.clone() {
        Adt0::C0(h2, _, _, _, _) => {
            h2
        }
    }, f5(v1.clone()))?;
    let a5 = f6(f7(Fn0::F8(v1, v2.clone()), List::<Bytes>::nil(), v3.clone())?);
    let a6 = {
        let a3 = f9(List::cons(Str::lit("sdk"), List::cons(f10(), List::<Str>::nil())));
        let a4 = f9(List::cons(Str::lit("check"), List::cons(f11(v3, v2), List::<Str>::nil())));
        append_bytes(a3, a4)
    };
    Ok(append_bytes(a5, a6))
}

pub fn f1(v0: Bytes) -> R<Adt0> {
    let v1: Adt0 = f12(Fn1::F13, Adt0::C0(List::<(Bytes, Bytes)>::nil(), List::<Adt1>::nil(), Str::lit(""), List::<Str>::nil(), Adt4::C3), f14(v0)?)?;
    Ok(Adt0::C0(f15(match v1.clone() {
        Adt0::C0(h7, _, _, _, _) => {
            h7
        }
    }), match v1.clone() {
        Adt0::C0(_, h8, _, _, _) => {
            h8
        }
    }, match v1.clone() {
        Adt0::C0(_, _, h9, _, _) => {
            h9
        }
    }, match v1.clone() {
        Adt0::C0(_, _, _, h10, _) => {
            h10
        }
    }, match v1 {
        Adt0::C0(_, _, _, _, h11) => {
            h11
        }
    }))
}

pub fn f2(v0: Adt4) -> List<Str> {
    f16(Fn2::F17, List::<Str>::nil(), f18(v0))
}

pub fn f3(v0: List<Adt6>, v1: List<(Bytes, Bytes)>, v2: List<(Str, bool)>) -> R<List<Adt5>> {
    let (h12, _) = f19(Fn3::F20(v2, v1), (List::<Adt5>::nil(), List::<(List<Str>, Str)>::nil()), v0)?;
    Ok(h12)
}

pub fn f4() -> List<Adt6> {
    f21(Fn4::F22, List::<Adt6>::nil(), f23())
}

pub fn f5(v0: Adt0) -> List<(Str, bool)> {
    let v1: Adt9 = Adt9::C0(match v0.clone() {
        Adt0::C0(_, _, h13, _, _) => {
            h13
        }
    }, match v0.clone() {
        Adt0::C0(_, _, _, h14, _) => {
            h14
        }
    });
    f24(Fn5::F25(v1), List::<(Str, bool)>::nil(), match v0 {
        Adt0::C0(_, h15, _, _, _) => {
            h15
        }
    })
}

pub fn f6(v0: List<Bytes>) -> Bytes {
    f26(f27(v0))
}

pub fn f7(v0: Fn0, p19: List<Bytes>, p20: List<Adt5>) -> R<List<Bytes>> {
    let m18 = (p19, p20);
    {
        let mut m18 = m18;
        loop {
            let step = {
                let (v1, v2) = m18;
                let m16 = v2;
                match m16.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<Adt5>), R<List<Bytes>>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<Adt5>), R<List<Bytes>>>(({
                            let c17: Fn0 = v0.clone();
                            c17.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m18 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f8(v0: Adt0, v1: List<Str>, v2: List<Bytes>, v3: Adt5) -> R<List<Bytes>> {
    Ok(List::cons(f28(v3, v1, match v0 {
        Adt0::C0(h21, _, _, _, _) => {
            h21
        }
    })?, v2))
}

pub fn f9(v0: List<Str>) -> Bytes {
    f29(f30(Fn6::F31, List::<Bytes>::nil(), v0))
}

pub fn f10() -> Str {
    Str::lit("ghcr.io/uor-foundation/prismpm-sdk@sha256:d6c263a733a6bc36e0458c3f5b9a1f5ea9c14dfbe8c257d3f650a960b5fe633c")
}

pub fn f11(v0: List<Adt5>, v1: List<Str>) -> Str {
    f32(Fn7::F33(v1), Str::lit("success"), v0)
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
            f41(f23())
        }
        Adt4::C1 => {
            f42(f23())
        }
        Adt4::C2 => {
            f42(f23())
        }
        Adt4::C3 => {
            f42(f23())
        }
    }
}

pub fn f19(v0: Fn3, p48: (List<Adt5>, List<(List<Str>, Str)>), p49: List<Adt6>) -> R<(List<Adt5>, List<(List<Str>, Str)>)> {
    let m47 = (p48, p49);
    {
        let mut m47 = m47;
        loop {
            let step = {
                let (v1, v2) = m47;
                let m45 = v2;
                match m45.uncons() {
                    None => {
                        Err::<((List<Adt5>, List<(List<Str>, Str)>), List<Adt6>), R<(List<Adt5>, List<(List<Str>, Str)>)>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<((List<Adt5>, List<(List<Str>, Str)>), List<Adt6>), R<(List<Adt5>, List<(List<Str>, Str)>)>>(({
                            let c46: Fn3 = v0.clone();
                            c46.apply(v1, v3)?
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

pub fn f20(v0: List<(Str, bool)>, v1: List<(Bytes, Bytes)>, v2: (List<Adt5>, List<(List<Str>, Str)>), v3: Adt6) -> R<(List<Adt5>, List<(List<Str>, Str)>)> {
    f43(v1, v0, v2, v3)
}

pub fn f21(v0: Fn4, p53: List<Adt6>, p54: List<Adt6>) -> List<Adt6> {
    let m52 = (p53, p54);
    {
        let mut m52 = m52;
        loop {
            let step = {
                let (v1, v2) = m52;
                let m50 = v2;
                match m50.uncons() {
                    None => {
                        Err::<(List<Adt6>, List<Adt6>), List<Adt6>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt6>, List<Adt6>), List<Adt6>>(({
                            let c51: Fn4 = v0.clone();
                            c51.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m52 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f22(v0: List<Adt6>, v1: Adt6) -> List<Adt6> {
    let a55 = v0;
    let a56 = List::cons(f44(v1), List::<Adt6>::nil());
    append_list(a55, a56)
}

pub fn f23() -> List<Adt6> {
    f45(f46())
}

pub fn f24(v0: Fn5, p60: List<(Str, bool)>, p61: List<Adt1>) -> List<(Str, bool)> {
    let m59 = (p60, p61);
    {
        let mut m59 = m59;
        loop {
            let step = {
                let (v1, v2) = m59;
                let m57 = v2;
                match m57.uncons() {
                    None => {
                        Err::<(List<(Str, bool)>, List<Adt1>), List<(Str, bool)>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<(Str, bool)>, List<Adt1>), List<(Str, bool)>>(({
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

pub fn f25(v0: Adt9, v1: List<(Str, bool)>, v2: Adt1) -> List<(Str, bool)> {
    if f47(v2.clone(), v0) {
        List::cons((match v2.clone() {
            Adt1::C0(_, h62, _, _, _, _) => {
                h62
            }
        }, match v2 {
            Adt1::C0(_, _, h63, _, _, _) => {
                h63
            }
        }), v1)
    } else {
        v1
    }
}

pub fn f26(v0: List<Bytes>) -> Bytes {
    let m66 = {
        let (h64, _) = f48(Fn10::F49, {
            let a65 = v0.clone();
            length_list(a65)
        }, v0);
        h64
    };
    match m66.uncons() {
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

pub fn f28(v0: Adt5, v1: List<Str>, v2: List<(Bytes, Bytes)>) -> R<Bytes> {
    let v3: Adt6 = match v0.clone() {
        Adt5::C0(h67, _, _) => {
            h67
        }
    };
    let v4: Str = match v3.clone() {
        Adt6::C0(h68, _, _, _, _, _) => {
            h68
        }
    };
    let v5: Adt10 = f52(v4.clone());
    let v6: Bytes = {
        let a76 = {
            let a72 = f9(List::cons(Str::lit("obligation"), List::cons(v4.clone(), List::cons(f53(match v0.clone() {
                Adt5::C0(_, _, h69) => {
                    h69
                }
            }), List::cons(match v0.clone() {
                Adt5::C0(_, h70, _) => {
                    h70
                }
            }, List::<Str>::nil())))));
            let a73 = f9(List::cons(Str::lit("run"), List::cons(v4.clone(), List::cons(match v3.clone() {
                Adt6::C0(_, _, _, h71, _, _) => {
                    h71
                }
            }, List::<Str>::nil()))));
            append_bytes(a72, a73)
        };
        let a77 = f9(List::cons(Str::lit("access"), List::cons(v4.clone(), List::cons(f54(match v5.clone() {
            Adt10::C0(_, _, _, _, _, h74) => {
                h74
            }
        }), List::cons(match v5 {
            Adt10::C0(h75, _, _, _, _, _) => {
                h75
            }
        }, List::<Str>::nil())))));
        append_bytes(a76, a77)
    };
    let v7: Bytes = f29(List::cons(f55(Str::lit("sandbox")), List::cons(f55(v4.clone()), List::cons(f56(v4.clone()), List::<Bytes>::nil()))));
    let v8: bool = if f57(match v0.clone() {
        Adt5::C0(_, _, h78) => {
            h78
        }
    }) {
        f58(v4.clone(), v1.clone())
    } else {
        false
    };
    let v9: Bytes = if v8 {
        let a80 = f9(List::cons(Str::lit("establish"), List::cons(v4.clone(), List::<Str>::nil())));
        let a81 = f59(v4.clone(), match v3 {
            Adt6::C0(_, _, _, _, h79, _) => {
                h79
            }
        }, v2)?;
        append_bytes(a80, a81)
    } else {
        Bytes::lit(&[])
    };
    let v10: Bytes = if f58(v4.clone(), v1) {
        f9(List::cons(Str::lit("status"), List::cons(v4, List::cons(f60(match v0 {
            Adt5::C0(_, _, h82) => {
                h82
            }
        }), List::<Str>::nil()))))
    } else {
        Bytes::lit(&[])
    };
    let a87 = {
        let a85 = {
            let a83 = v6;
            let a84 = v7;
            append_bytes(a83, a84)
        };
        let a86 = v9;
        append_bytes(a85, a86)
    };
    let a88 = v10;
    Ok(append_bytes(a87, a88))
}

pub fn f29(v0: List<Bytes>) -> Bytes {
    let a89 = f61(v0, Bytes::lit(&[0x20]));
    let a90 = Bytes::lit(&[0x0a]);
    append_bytes(a89, a90)
}

pub fn f30(v0: Fn6, p94: List<Bytes>, p95: List<Str>) -> List<Bytes> {
    let m93 = (p94, p95);
    {
        let mut m93 = m93;
        loop {
            let step = {
                let (v1, v2) = m93;
                let m91 = v2;
                match m91.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<Str>), List<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<Str>), List<Bytes>>(({
                            let c92: Fn6 = v0.clone();
                            c92.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m93 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f31(v0: List<Bytes>, v1: Str) -> List<Bytes> {
    let a96 = v0;
    let a97 = List::cons(f55(v1), List::<Bytes>::nil());
    append_list(a96, a97)
}

pub fn f32(v0: Fn7, p101: Str, p102: List<Adt5>) -> Str {
    let m100 = (p101, p102);
    {
        let mut m100 = m100;
        loop {
            let step = {
                let (v1, v2) = m100;
                let m98 = v2;
                match m98.uncons() {
                    None => {
                        Err::<(Str, List<Adt5>), Str>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Str, List<Adt5>), Str>(({
                            let c99: Fn7 = v0.clone();
                            c99.apply(v1, v3)
                        }, v4))
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

pub fn f33(v0: List<Str>, v1: Str, v2: Adt5) -> Str {
    if f58({
        let m105 = match v2.clone() {
            Adt5::C0(h104, _, _) => {
                h104
            }
        };
        match m105 {
            Adt6::C0(h103, _, _, _, _, _) => {
                h103
            }
        }
    }, v0) {
        let v3: Str = f60(match v2 {
            Adt5::C0(_, _, h106) => {
                h106
            }
        });
        let a107 = v1.clone();
        let a108 = Str::lit("failure");
        if equal(a107, a108) {
            v1
        } else {
            let a109 = v3.clone();
            let a110 = Str::lit("failure");
            if equal(a109, a110) {
                v3
            } else {
                let a111 = v1.clone();
                let a112 = Str::lit("success");
                if equal(a111, a112) {
                    v3
                } else {
                    v1
                }
            }
        }
    } else {
        v1
    }
}

pub fn f34(v0: Adt0, v1: Bytes) -> R<Adt0> {
    let v2: (Bytes, Bytes) = f62(v1)?;
    let v3: Bytes = {
        let (h113, _) = v2.clone();
        h113
    };
    let v4: (Bytes, Bytes) = f62({
        let (_, h114) = v2.clone();
        h114
    })?;
    let a115 = v3.clone();
    let a116 = f55(Str::lit("tree"));
    if equal(a115, a116) {
        Ok(Adt0::C0(List::cons(({
            let (h117, _) = v4;
            h117
        }, {
            let (_, h118) = v4;
            h118
        }), match v0.clone() {
            Adt0::C0(h119, _, _, _, _) => {
                h119
            }
        }), match v0.clone() {
            Adt0::C0(_, h120, _, _, _) => {
                h120
            }
        }, match v0.clone() {
            Adt0::C0(_, _, h121, _, _) => {
                h121
            }
        }, match v0.clone() {
            Adt0::C0(_, _, _, h122, _) => {
                h122
            }
        }, match v0 {
            Adt0::C0(_, _, _, _, h123) => {
                h123
            }
        }))
    } else {
        let a124 = v3.clone();
        let a125 = f55(Str::lit("signed"));
        if equal(a124, a125) {
            Ok(Adt0::C0(match v0.clone() {
                Adt0::C0(h126, _, _, _, _) => {
                    h126
                }
            }, {
                let v5: (Bytes, Bytes) = f62({
                    let (_, h127) = v4;
                    h127
                })?;
                let v6: (Bytes, Bytes) = f62({
                    let (_, h128) = v5;
                    h128
                })?;
                let v7: (Bytes, Bytes) = f62({
                    let (_, h129) = v6;
                    h129
                })?;
                let v8: (Bytes, Bytes) = f62({
                    let (_, h130) = v7;
                    h130
                })?;
                List::cons(Adt1::C0(f63({
                    let (h131, _) = v4;
                    h131
                }), f63({
                    let (h132, _) = v5;
                    h132
                }), f64({
                    let (h133, _) = v6;
                    h133
                }), f65({
                    let (h134, _) = v7;
                    h134
                }), f63({
                    let (_, h135) = v8;
                    h135
                }), f66({
                    let (h136, _) = v8;
                    h136
                })), match v0.clone() {
                    Adt0::C0(_, h137, _, _, _) => {
                        h137
                    }
                })
            }, match v0.clone() {
                Adt0::C0(_, _, h138, _, _) => {
                    h138
                }
            }, match v0.clone() {
                Adt0::C0(_, _, _, h139, _) => {
                    h139
                }
            }, match v0 {
                Adt0::C0(_, _, _, _, h140) => {
                    h140
                }
            }))
        } else {
            let a141 = v3.clone();
            let a142 = f55(Str::lit("trust-repository"));
            if equal(a141, a142) {
                Ok(Adt0::C0(match v0.clone() {
                    Adt0::C0(h143, _, _, _, _) => {
                        h143
                    }
                }, match v0.clone() {
                    Adt0::C0(_, h144, _, _, _) => {
                        h144
                    }
                }, f63({
                    let (_, h145) = v2;
                    h145
                }), match v0.clone() {
                    Adt0::C0(_, _, _, h146, _) => {
                        h146
                    }
                }, match v0 {
                    Adt0::C0(_, _, _, _, h147) => {
                        h147
                    }
                }))
            } else {
                let a148 = v3.clone();
                let a149 = f55(Str::lit("trust-maintainer"));
                if equal(a148, a149) {
                    Ok(Adt0::C0(match v0.clone() {
                        Adt0::C0(h150, _, _, _, _) => {
                            h150
                        }
                    }, match v0.clone() {
                        Adt0::C0(_, h151, _, _, _) => {
                            h151
                        }
                    }, match v0.clone() {
                        Adt0::C0(_, _, h152, _, _) => {
                            h152
                        }
                    }, List::cons(f63({
                        let (_, h153) = v2;
                        h153
                    }), match v0.clone() {
                        Adt0::C0(_, _, _, h154, _) => {
                            h154
                        }
                    }), match v0 {
                        Adt0::C0(_, _, _, _, h155) => {
                            h155
                        }
                    }))
                } else {
                    let a156 = v3;
                    let a157 = f55(Str::lit("event"));
                    if equal(a156, a157) {
                        Ok(Adt0::C0(match v0.clone() {
                            Adt0::C0(h158, _, _, _, _) => {
                                h158
                            }
                        }, match v0.clone() {
                            Adt0::C0(_, h159, _, _, _) => {
                                h159
                            }
                        }, match v0.clone() {
                            Adt0::C0(_, _, h160, _, _) => {
                                h160
                            }
                        }, match v0 {
                            Adt0::C0(_, _, _, h161, _) => {
                                h161
                            }
                        }, f67({
                            let (_, h162) = v2;
                            h162
                        })))
                    } else {
                        Ok(v0)
                    }
                }
            }
        }
    }
}

pub fn f35(v0: Fn8, p167: u64, p168: (u64, (u64, List<Bytes>))) -> R<((u64, (u64, List<Bytes>)), bool)> {
    let m166 = (p167, p168);
    {
        let mut m166 = m166;
        loop {
            let step = {
                let (v1, v2) = m166;
                let m163 = v1;
                if m163 == 0 {
                    Err::<(u64, (u64, (u64, List<Bytes>))), R<((u64, (u64, List<Bytes>)), bool)>>(Ok((v2, false)))
                } else {
                    let v3 = m163 - 1;
                    let m165 = {
                        let c164: Fn8 = v0.clone();
                        c164.apply(v2.clone())?
                    };
                    match m165 {
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
                Ok(next) => { m166 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f36(v0: Bytes, v1: (u64, (u64, List<Bytes>))) -> R<Option<(u64, (u64, List<Bytes>))>> {
    f68(v0, v1)
}

pub fn f37(v0: Bytes, v1: u64, v2: u64) -> Bytes {
    let m172 = {
        let a169 = v0;
        let a170 = v1;
        let a171 = v2;
        slice_bytes(a169, a170, a171)
    };
    match m172 {
        None => {
            Bytes::lit(&[])
        }
        Some(v3) => {
            v3
        }
    }
}

pub fn f38(v0: Fn9, p176: List<(Bytes, Bytes)>, p177: List<(Bytes, Bytes)>) -> List<(Bytes, Bytes)> {
    let m175 = (p176, p177);
    {
        let mut m175 = m175;
        loop {
            let step = {
                let (v1, v2) = m175;
                let m173 = v2;
                match m173.uncons() {
                    None => {
                        Err::<(List<(Bytes, Bytes)>, List<(Bytes, Bytes)>), List<(Bytes, Bytes)>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<(Bytes, Bytes)>, List<(Bytes, Bytes)>), List<(Bytes, Bytes)>>(({
                            let c174: Fn9 = v0.clone();
                            c174.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m175 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f39(v0: List<(Bytes, Bytes)>, v1: (Bytes, Bytes)) -> List<(Bytes, Bytes)> {
    List::cons(v1, v0)
}

pub fn f40(v0: Str) -> bool {
    f58(v0, f69())
}

pub fn f41(v0: List<Adt6>) -> List<Str> {
    f70(Fn12::F71, List::<Str>::nil(), v0)
}

pub fn f42(v0: List<Adt6>) -> List<Str> {
    f70(Fn12::F72, List::<Str>::nil(), v0)
}

pub fn f43(v0: List<(Bytes, Bytes)>, v1: List<(Str, bool)>, v2: (List<Adt5>, List<(List<Str>, Str)>), v3: Adt6) -> R<(List<Adt5>, List<(List<Str>, Str)>)> {
    let v4: List<Adt5> = {
        let (h178, _) = v2;
        h178
    };
    let v5: List<(List<Str>, Str)> = {
        let (_, h179) = v2;
        h179
    };
    let v6: List<Str> = match v3.clone() {
        Adt6::C0(_, _, _, _, h180, _) => {
            h180
        }
    };
    let v8: Str = {
        let m181 = f73(v6.clone(), v5.clone());
        match m181 {
            None => {
                f74(v6.clone(), v0)?
            }
            Some(v7) => {
                v7
            }
        }
    };
    let v9: List<Adt5> = f75(match v3.clone() {
        Adt6::C0(_, _, _, _, _, h182) => {
            h182
        }
    }, v4.clone());
    let v10: Str = f76(v3.clone(), v8.clone(), v9.clone())?;
    let v11: List<Adt8> = if f77(match v3.clone() {
        Adt6::C0(_, _, _, _, _, h183) => {
            h183
        }
    }, v4.clone()) {
        f78(v9)
    } else {
        List::cons(Adt8::C3, List::<Adt8>::nil())
    };
    Ok(({
        let a185 = v4;
        let a186 = List::cons(Adt5::C0(v3.clone(), v10.clone(), f79(match v3 {
            Adt6::C0(_, h184, _, _, _, _) => {
                h184
            }
        }, v10, v1, v11)), List::<Adt5>::nil());
        append_list(a185, a186)
    }, List::cons((v6, v8), v5)))
}

pub fn f44(v0: Adt6) -> Adt6 {
    Adt6::C0(match v0.clone() {
        Adt6::C0(h187, _, _, _, _, _) => {
            h187
        }
    }, match v0.clone() {
        Adt6::C0(_, h188, _, _, _, _) => {
            h188
        }
    }, f63(f56(match v0.clone() {
        Adt6::C0(h189, _, _, _, _, _) => {
            h189
        }
    })), match v0.clone() {
        Adt6::C0(_, _, _, h190, _, _) => {
            h190
        }
    }, match v0.clone() {
        Adt6::C0(_, _, _, _, h191, _) => {
            h191
        }
    }, match v0 {
        Adt6::C0(_, _, _, _, _, h192) => {
            h192
        }
    })
}

pub fn f45(v0: List<Adt6>) -> List<Adt6> {
    f21(Fn4::F80, List::<Adt6>::nil(), v0)
}

pub fn f46() -> List<Adt6> {
    List::cons(f81(Str::lit("policy"), Adt7::C0, Str::lit("actions"), Str::lit("release.yml/policy"), List::cons(Str::lit(".github/workflows/release.yml"), List::cons(Str::lit("Cargo.toml"), List::cons(Str::lit("model/errors.toml"), List::cons(Str::lit("scripts/"), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil())))))), List::<Str>::nil()), List::cons(f81(Str::lit("factory-model"), Adt7::C0, Str::lit("host"), Str::lit("bash prism-factory/check.sh"), List::cons(Str::lit(".github/workflows/factory.yml"), List::cons(Str::lit(".github/workflows/prism-delegation.yml"), List::cons(Str::lit(".github/workflows/release-cut.yml"), List::cons(Str::lit(".github/workflows/release.yml"), List::cons(Str::lit("prism-factory/"), List::cons(Str::lit("vendor/lexlean/"), List::<Str>::nil())))))), List::<Str>::nil()), List::cons(f81(Str::lit("plumbing"), Adt7::C0, Str::lit("actions"), Str::lit("release.yml/devcontainer-image"), List::cons(Str::lit(""), List::cons(Str::lit("@run"), List::<Str>::nil())), List::cons(Str::lit("policy"), List::<Str>::nil())), List::cons(f81(Str::lit("vv-sdk"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/vv-sdk"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.mjs"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/release-rebuild.sh"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-candidate-sbom.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/vv-sdk.yml"), List::<Str>::nil())))))))))))))))))))))))))))))))), List::<Str>::nil()), List::cons(f81(Str::lit("source-vv"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/source-vv"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.mjs"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/release-rebuild.sh"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-candidate-sbom.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/source-vv.yml"), List::<Str>::nil())))))))))))))))))))))))))))))))), List::cons(Str::lit("vv-sdk"), List::<Str>::nil())), List::cons(f81(Str::lit("build"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/build"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-candidate-sbom.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("scripts/release-gate-evidence.mjs"), List::cons(Str::lit("scripts/release-phases.mjs"), List::cons(Str::lit("scripts/release-rebuild.sh"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/image-platforms.yml"), List::cons(Str::lit("prism-factory/jobs/images.yml"), List::cons(Str::lit("prism-factory/jobs/reproducibility.yml"), List::cons(Str::lit("prism-factory/jobs/native.yml"), List::cons(Str::lit("prism-factory/jobs/installed-sdk.yml"), List::<Str>::nil())))))))))))))))))))))))))))))))))))), List::<Str>::nil()), List::cons(f81(Str::lit("gate"), Adt7::C0, Str::lit("actions"), Str::lit("release.yml/gate"), List::cons(Str::lit(""), List::cons(Str::lit("@run"), List::<Str>::nil())), List::cons(Str::lit("plumbing"), List::cons(Str::lit("source-vv"), List::<Str>::nil()))), List::cons(f81(Str::lit("oci-native"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/oci-native"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("gate"), List::cons(Str::lit("build"), List::<Str>::nil()))), List::cons(f81(Str::lit("crates"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/crates"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("oci-native"), List::<Str>::nil())), List::cons(f81(Str::lit("release"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/release"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("factory-model"), List::cons(Str::lit("crates"), List::<Str>::nil()))), List::<Adt6>::nil()))))))))))
}

pub fn f47(v0: Adt1, v1: Adt9) -> bool {
    let m194 = match v0.clone() {
        Adt1::C0(_, _, _, h193, _, _) => {
            h193
        }
    };
    match m194 {
        Adt2::C0 => {
            let a197 = match v0 {
                Adt1::C0(_, _, _, _, h195, _) => {
                    h195
                }
            };
            let a198 = match v1 {
                Adt9::C0(h196, _) => {
                    h196
                }
            };
            equal(a197, a198)
        }
        Adt2::C1 => {
            f58(match v0 {
                Adt1::C0(_, _, _, _, h199, _) => {
                    h199
                }
            }, match v1 {
                Adt9::C0(_, h200) => {
                    h200
                }
            })
        }
        Adt2::C2 => {
            false
        }
    }
}

pub fn f48(v0: Fn10, p205: u64, p206: List<Bytes>) -> (List<Bytes>, bool) {
    let m204 = (p205, p206);
    {
        let mut m204 = m204;
        loop {
            let step = {
                let (v1, v2) = m204;
                let m201 = v1;
                if m201 == 0 {
                    Err::<(u64, List<Bytes>), (List<Bytes>, bool)>((v2, false))
                } else {
                    let v3 = m201 - 1;
                    let m203 = {
                        let c202: Fn10 = v0.clone();
                        c202.apply(v2.clone())
                    };
                    match m203 {
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
                Ok(next) => { m204 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f49(v0: List<Bytes>) -> Option<List<Bytes>> {
    f82(v0)
}

pub fn f50(v0: Fn11, p210: List<Bytes>, p211: List<Bytes>) -> List<Bytes> {
    let m209 = (p210, p211);
    {
        let mut m209 = m209;
        loop {
            let step = {
                let (v1, v2) = m209;
                let m207 = v2;
                match m207.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<Bytes>), List<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<Bytes>), List<Bytes>>(({
                            let c208: Fn11 = v0.clone();
                            c208.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m209 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f51(v0: List<Bytes>, v1: Bytes) -> List<Bytes> {
    List::cons(v1, v0)
}

pub fn f52(v0: Str) -> Adt10 {
    f83(Fn13::F84(v0), f85(Str::lit("@sdk"), Adt11::C0), f86())
}

pub fn f53(v0: Adt8) -> Str {
    let m212 = v0;
    match m212 {
        Adt8::C0 => {
            Str::lit("proved")
        }
        Adt8::C1 => {
            Str::lit("observe")
        }
        Adt8::C2 => {
            Str::lit("refuted")
        }
        Adt8::C3 => {
            Str::lit("blocked")
        }
    }
}

pub fn f54(v0: Adt11) -> Str {
    let m213 = v0;
    match m213 {
        Adt11::C0 => {
            Str::lit("sealed")
        }
        Adt11::C1 => {
            Str::lit("pinned")
        }
        Adt11::C2 => {
            Str::lit("live")
        }
    }
}

pub fn f55(v0: Str) -> Bytes {
    let a214 = v0;
    utf8_encode(a214)
}

pub fn f56(v0: Str) -> Bytes {
    let v1: Adt10 = f52(v0);
    f61(List::cons({
        let a215 = Str::lit("prism/1");
        utf8_encode(a215)
    }, List::cons({
        let a216 = f87(v1.clone());
        utf8_encode(a216)
    }, List::cons({
        let a218 = match v1.clone() {
            Adt10::C0(_, h217, _, _, _, _) => {
                h217
            }
        };
        utf8_encode(a218)
    }, List::cons({
        let a220 = match v1.clone() {
            Adt10::C0(_, _, h219, _, _, _) => {
                h219
            }
        };
        utf8_encode(a220)
    }, List::cons({
        let a222 = match v1.clone() {
            Adt10::C0(_, _, _, h221, _, _) => {
                h221
            }
        };
        utf8_encode(a222)
    }, List::cons({
        let a224 = match v1.clone() {
            Adt10::C0(_, _, _, _, h223, _) => {
                h223
            }
        };
        utf8_encode(a224)
    }, List::cons({
        let a226 = f54(match v1 {
            Adt10::C0(_, _, _, _, _, h225) => {
                h225
            }
        });
        utf8_encode(a226)
    }, List::<Bytes>::nil()))))))), Bytes::lit(&[0x20]))
}

pub fn f57(v0: Adt8) -> bool {
    let m227 = v0;
    match m227 {
        Adt8::C0 => {
            false
        }
        Adt8::C1 => {
            true
        }
        Adt8::C2 => {
            false
        }
        Adt8::C3 => {
            false
        }
    }
}

pub fn f58(v0: Str, v1: List<Str>) -> bool {
    f88(Fn14::F89(v0), false, v1)
}

pub fn f59(v0: Str, v1: List<Str>, v2: List<(Bytes, Bytes)>) -> R<Bytes> {
    Ok(f6(f90(Fn15::F91(v1, v0), List::<Bytes>::nil(), v2)?))
}

pub fn f60(v0: Adt8) -> Str {
    if f92(v0.clone()) {
        Str::lit("success")
    } else {
        let a228 = f53(v0);
        let a229 = Str::lit("refuted");
        if equal(a228, a229) {
            Str::lit("failure")
        } else {
            Str::lit("pending")
        }
    }
}

pub fn f61(v0: List<Bytes>, v1: Bytes) -> Bytes {
    let m230 = f93(Fn16::F94(v1), None::<Bytes>, v0);
    match m230 {
        None => {
            Bytes::lit(&[])
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f62(v0: Bytes) -> R<(Bytes, Bytes)> {
    let m231 = f95(v0.clone(), Bytes::lit(&[0x20]))?;
    match m231 {
        None => {
            Ok((v0, Bytes::lit(&[])))
        }
        Some(v1) => {
            Ok((f37(v0.clone(), 0u64, v1), f37(v0.clone(), {
                let a232 = v1;
                let a233 = 1u64;
                nat_add(a232, a233)?
            }, {
                let a237 = {
                    let a234 = v0;
                    length_bytes(a234)
                };
                let a238 = {
                    let a235 = v1;
                    let a236 = 1u64;
                    nat_add(a235, a236)?
                };
                nat_sub(a237, a238)
            })))
        }
    }
}

pub fn f63(v0: Bytes) -> Str {
    let m240 = {
        let a239 = v0;
        utf8_decode(a239)
    };
    match m240 {
        None => {
            Str::lit("")
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f64(v0: Bytes) -> bool {
    let a241 = v0;
    let a242 = f55(Str::lit("pass"));
    equal(a241, a242)
}

pub fn f65(v0: Bytes) -> Adt2 {
    let a243 = v0.clone();
    let a244 = f55(Str::lit("workflow"));
    if equal(a243, a244) {
        Adt2::C0
    } else {
        let a245 = v0;
        let a246 = f55(Str::lit("maintainer"));
        if equal(a245, a246) {
            Adt2::C1
        } else {
            Adt2::C2
        }
    }
}

pub fn f66(v0: Bytes) -> Adt3 {
    let a247 = v0.clone();
    let a248 = f55(Str::lit("workstation"));
    if equal(a247, a248) {
        Adt3::C1
    } else {
        let a249 = v0;
        let a250 = f55(Str::lit("browser"));
        if equal(a249, a250) {
            Adt3::C2
        } else {
            Adt3::C0
        }
    }
}

pub fn f67(v0: Bytes) -> Adt4 {
    let a251 = v0.clone();
    let a252 = f55(Str::lit("pull_request"));
    if equal(a251, a252) {
        Adt4::C0
    } else {
        let a253 = v0.clone();
        let a254 = f55(Str::lit("push"));
        if equal(a253, a254) {
            Adt4::C1
        } else {
            let a255 = v0;
            let a256 = f55(Str::lit("tag"));
            if equal(a255, a256) {
                Adt4::C2
            } else {
                Adt4::C3
            }
        }
    }
}

pub fn f68(v0: Bytes, v1: (u64, (u64, List<Bytes>))) -> R<Option<(u64, (u64, List<Bytes>))>> {
    let v2: u64 = {
        let (h257, _) = v1.clone();
        h257
    };
    let v3: u64 = {
        let (h258, _) = {
            let (_, h259) = v1.clone();
            h259
        };
        h258
    };
    let v4: List<Bytes> = {
        let (_, h260) = {
            let (_, h261) = v1;
            h261
        };
        h260
    };
    let m262 = f96(v0.clone(), v2);
    match m262 {
        None => {
            Ok(None::<(u64, (u64, List<Bytes>))>)
        }
        Some(v5) => {
            let a263 = v5;
            let a264 = 10u8;
            if equal(a263, a264) {
                Ok(Some(({
                    let a265 = v2;
                    let a266 = 1u64;
                    nat_add(a265, a266)?
                }, ({
                    let a267 = v2;
                    let a268 = 1u64;
                    nat_add(a267, a268)?
                }, List::cons(f97(f37(v0, v3, {
                    let a269 = v2;
                    let a270 = v3;
                    nat_sub(a269, a270)
                })), v4)))))
            } else {
                Ok(Some(({
                    let a271 = v2;
                    let a272 = 1u64;
                    nat_add(a271, a272)?
                }, (v3, v4))))
            }
        }
    }
}

pub fn f69() -> List<Str> {
    List::cons(Str::lit("factory-model"), List::<Str>::nil())
}

pub fn f70(v0: Fn12, p276: List<Str>, p277: List<Adt6>) -> List<Str> {
    let m275 = (p276, p277);
    {
        let mut m275 = m275;
        loop {
            let step = {
                let (v1, v2) = m275;
                let m273 = v2;
                match m273.uncons() {
                    None => {
                        Err::<(List<Str>, List<Adt6>), List<Str>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Str>, List<Adt6>), List<Str>>(({
                            let c274: Fn12 = v0.clone();
                            c274.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m275 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f71(v0: List<Str>, v1: Adt6) -> List<Str> {
    if f98(v1.clone()) {
        let a279 = v0;
        let a280 = List::cons(match v1 {
            Adt6::C0(h278, _, _, _, _, _) => {
                h278
            }
        }, List::<Str>::nil());
        append_list(a279, a280)
    } else {
        v0
    }
}

pub fn f72(v0: List<Str>, v1: Adt6) -> List<Str> {
    let a282 = v0;
    let a283 = List::cons(match v1 {
        Adt6::C0(h281, _, _, _, _, _) => {
            h281
        }
    }, List::<Str>::nil());
    append_list(a282, a283)
}

pub fn f73(v0: List<Str>, v1: List<(List<Str>, Str)>) -> Option<Str> {
    f99(Fn17::F100(v0), None::<Str>, v1)
}

pub fn f74(v0: List<Str>, v1: List<(Bytes, Bytes)>) -> R<Str> {
    Ok(f63(f101(f102(v0, v1)?)?))
}

pub fn f75(v0: List<Str>, v1: List<Adt5>) -> List<Adt5> {
    f103(Fn18::F104(v1), List::<Adt5>::nil(), v0)
}

pub fn f76(v0: Adt6, v1: Str, v2: List<Adt5>) -> R<Str> {
    Ok(f63(f101(f105(v0, v1, v2)?)?))
}

pub fn f77(v0: List<Str>, v1: List<Adt5>) -> bool {
    f88(Fn14::F106(v1), true, v0)
}

pub fn f78(v0: List<Adt5>) -> List<Adt8> {
    f107(Fn19::F108, List::<Adt8>::nil(), v0)
}

pub fn f79(v0: Adt7, v1: Str, v2: List<(Str, bool)>, v3: List<Adt8>) -> Adt8 {
    if f109(v3) {
        let m284 = f110(v1, v2);
        match m284 {
            None => {
                Adt8::C1
            }
            Some(v4) => {
                if v4 {
                    Adt8::C0
                } else {
                    let m285 = v0;
                    match m285 {
                        Adt7::C0 => {
                            Adt8::C2
                        }
                        Adt7::C1 => {
                            Adt8::C1
                        }
                    }
                }
            }
        }
    } else {
        Adt8::C3
    }
}

pub fn f80(v0: List<Adt6>, v1: Adt6) -> List<Adt6> {
    let a286 = v0;
    let a287 = List::cons(f111(v1), List::<Adt6>::nil());
    append_list(a286, a287)
}

pub fn f81(v0: Str, v1: Adt7, v2: Str, v3: Str, v4: List<Str>, v5: List<Str>) -> Adt6 {
    Adt6::C0(v0, v1, v2, v3, v4, v5)
}

pub fn f82(v0: List<Bytes>) -> Option<List<Bytes>> {
    let m288 = v0.clone();
    match m288.uncons() {
        None => {
            None::<List<Bytes>>
        }
        Some((_, v2)) => {
            let m289 = v2;
            match m289.uncons() {
                None => {
                    None::<List<Bytes>>
                }
                Some((_, _)) => {
                    let v5: (Option<Bytes>, List<Bytes>) = f112(Fn20::F113, (None::<Bytes>, List::<Bytes>::nil()), v0);
                    let m291 = {
                        let (h290, _) = v5;
                        h290
                    };
                    match m291 {
                        None => {
                            Some(f27({
                                let (_, h293) = v5;
                                h293
                            }))
                        }
                        Some(v6) => {
                            Some(f27(List::cons(v6, {
                                let (_, h292) = v5;
                                h292
                            })))
                        }
                    }
                }
            }
        }
    }
}

pub fn f83(v0: Fn13, p297: Adt10, p298: List<(Str, Adt10)>) -> Adt10 {
    let m296 = (p297, p298);
    {
        let mut m296 = m296;
        loop {
            let step = {
                let (v1, v2) = m296;
                let m294 = v2;
                match m294.uncons() {
                    None => {
                        Err::<(Adt10, List<(Str, Adt10)>), Adt10>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Adt10, List<(Str, Adt10)>), Adt10>(({
                            let c295: Fn13 = v0.clone();
                            c295.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m296 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f84(v0: Str, v1: Adt10, v2: (Str, Adt10)) -> Adt10 {
    let a300 = {
        let (h299, _) = v2;
        h299
    };
    let a301 = v0;
    if equal(a300, a301) {
        let (_, h302) = v2;
        h302
    } else {
        v1
    }
}

pub fn f85(v0: Str, v1: Adt11) -> Adt10 {
    Adt10::C0(v0, Str::lit("1000:1000"), Str::lit("0022"), Str::lit("tmp/prismpm-home"), Str::lit("tmp"), v1)
}

pub fn f86() -> List<(Str, Adt10)> {
    List::cons((Str::lit("policy"), f85(Str::lit("@sdk"), Adt11::C0)), List::cons((Str::lit("factory-model"), f85(Str::lit("@sdk"), Adt11::C1)), List::cons((Str::lit("plumbing"), f85(Str::lit("@sdk"), Adt11::C1)), List::cons((Str::lit("vv-sdk"), f85(Str::lit("@sdk"), Adt11::C1)), List::cons((Str::lit("source-vv"), f85(Str::lit("@vv-sdk"), Adt11::C0)), List::cons((Str::lit("build"), f85(Str::lit("@sdk"), Adt11::C1)), List::cons((Str::lit("gate"), f85(Str::lit("@vv-sdk"), Adt11::C0)), List::cons((Str::lit("oci-native"), f85(Str::lit("@build"), Adt11::C1)), List::cons((Str::lit("crates"), f85(Str::lit("@build"), Adt11::C1)), List::cons((Str::lit("release"), f85(Str::lit("@build"), Adt11::C1)), List::<(Str, Adt10)>::nil()))))))))))
}

pub fn f87(v0: Adt10) -> Str {
    let a304 = match v0.clone() {
        Adt10::C0(h303, _, _, _, _, _) => {
            h303
        }
    };
    let a305 = Str::lit("@sdk");
    if equal(a304, a305) {
        f10()
    } else {
        match v0 {
            Adt10::C0(h306, _, _, _, _, _) => {
                h306
            }
        }
    }
}

pub fn f88(v0: Fn14, p310: bool, p311: List<Str>) -> bool {
    let m309 = (p310, p311);
    {
        let mut m309 = m309;
        loop {
            let step = {
                let (v1, v2) = m309;
                let m307 = v2;
                match m307.uncons() {
                    None => {
                        Err::<(bool, List<Str>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<Str>), bool>(({
                            let c308: Fn14 = v0.clone();
                            c308.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m309 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f89(v0: Str, v1: bool, v2: Str) -> bool {
    if v1 {
        true
    } else {
        let a312 = v2;
        let a313 = v0;
        equal(a312, a313)
    }
}

pub fn f90(v0: Fn15, p317: List<Bytes>, p318: List<(Bytes, Bytes)>) -> R<List<Bytes>> {
    let m316 = (p317, p318);
    {
        let mut m316 = m316;
        loop {
            let step = {
                let (v1, v2) = m316;
                let m314 = v2;
                match m314.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<(Bytes, Bytes)>), R<List<Bytes>>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<(Bytes, Bytes)>), R<List<Bytes>>>(({
                            let c315: Fn15 = v0.clone();
                            c315.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m316 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f91(v0: List<Str>, v1: Str, v2: List<Bytes>, v3: (Bytes, Bytes)) -> R<List<Bytes>> {
    if f114(v0, {
        let (_, h319) = v3.clone();
        h319
    })? {
        Ok(List::cons(f29(List::cons(f55(Str::lit("file")), List::cons(f55(v1), List::cons({
            let (_, h320) = v3;
            h320
        }, List::<Bytes>::nil())))), v2))
    } else {
        Ok(v2)
    }
}

pub fn f92(v0: Adt8) -> bool {
    let m321 = v0;
    match m321 {
        Adt8::C0 => {
            true
        }
        Adt8::C1 => {
            false
        }
        Adt8::C2 => {
            false
        }
        Adt8::C3 => {
            false
        }
    }
}

pub fn f93(v0: Fn16, p325: Option<Bytes>, p326: List<Bytes>) -> Option<Bytes> {
    let m324 = (p325, p326);
    {
        let mut m324 = m324;
        loop {
            let step = {
                let (v1, v2) = m324;
                let m322 = v2;
                match m322.uncons() {
                    None => {
                        Err::<(Option<Bytes>, List<Bytes>), Option<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Bytes>, List<Bytes>), Option<Bytes>>(({
                            let c323: Fn16 = v0.clone();
                            c323.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m324 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f94(v0: Bytes, v1: Option<Bytes>, v2: Bytes) -> Option<Bytes> {
    let m327 = v1;
    match m327 {
        None => {
            Some(v2)
        }
        Some(v3) => {
            Some({
                let a330 = {
                    let a328 = v3;
                    let a329 = v0;
                    append_bytes(a328, a329)
                };
                let a331 = v2;
                append_bytes(a330, a331)
            })
        }
    }
}

pub fn f95(v0: Bytes, v1: Bytes) -> R<Option<u64>> {
    let v2: u64 = {
        let a332 = v0.clone();
        length_bytes(a332)
    };
    let v3: u64 = {
        let a333 = v1.clone();
        length_bytes(a333)
    };
    let v4: u64 = {
        let (h334, _) = f115(Fn21::F116(v1.clone(), v3, v0.clone(), v2), {
            let a335 = v2;
            let a336 = 1u64;
            nat_add(a335, a336)?
        }, 0u64)?;
        h334
    };
    if f117(v0, v1, v4) {
        Ok(Some(v4))
    } else {
        Ok(None::<u64>)
    }
}

pub fn f96(v0: Bytes, v1: u64) -> Option<u8> {
    let a337 = v0;
    let a338 = v1;
    index_bytes(a337, a338)
}

pub fn f97(v0: Bytes) -> Bytes {
    if f118(v0.clone(), Bytes::lit(&[0x0d])) {
        f37(v0.clone(), 0u64, {
            let a340 = {
                let a339 = v0;
                length_bytes(a339)
            };
            let a341 = 1u64;
            nat_sub(a340, a341)
        })
    } else {
        v0
    }
}

pub fn f98(v0: Adt6) -> bool {
    let a343 = f58(Str::lit("@mode"), match v0.clone() {
        Adt6::C0(_, _, _, _, h342, _) => {
            h342
        }
    });
    if bool_not(a343) {
        let a345 = f58(Str::lit("@run"), match v0 {
            Adt6::C0(_, _, _, _, h344, _) => {
                h344
            }
        });
        bool_not(a345)
    } else {
        false
    }
}

pub fn f99(v0: Fn17, p349: Option<Str>, p350: List<(List<Str>, Str)>) -> Option<Str> {
    let m348 = (p349, p350);
    {
        let mut m348 = m348;
        loop {
            let step = {
                let (v1, v2) = m348;
                let m346 = v2;
                match m346.uncons() {
                    None => {
                        Err::<(Option<Str>, List<(List<Str>, Str)>), Option<Str>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Str>, List<(List<Str>, Str)>), Option<Str>>(({
                            let c347: Fn17 = v0.clone();
                            c347.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m348 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f100(v0: List<Str>, v1: Option<Str>, v2: (List<Str>, Str)) -> Option<Str> {
    if f119({
        let (h351, _) = v2;
        h351
    }, v0) {
        Some({
            let (_, h352) = v2;
            h352
        })
    } else {
        v1
    }
}

pub fn f101(v0: Bytes) -> R<Bytes> {
    Ok(f120(f121(v0)?))
}

pub fn f102(v0: List<Str>, v1: List<(Bytes, Bytes)>) -> R<Bytes> {
    Ok(f6(f90(Fn15::F122(v0), List::<Bytes>::nil(), v1)?))
}

pub fn f103(v0: Fn18, p356: List<Adt5>, p357: List<Str>) -> List<Adt5> {
    let m355 = (p356, p357);
    {
        let mut m355 = m355;
        loop {
            let step = {
                let (v1, v2) = m355;
                let m353 = v2;
                match m353.uncons() {
                    None => {
                        Err::<(List<Adt5>, List<Str>), List<Adt5>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt5>, List<Str>), List<Adt5>>(({
                            let c354: Fn18 = v0.clone();
                            c354.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m355 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f104(v0: List<Adt5>, v1: List<Adt5>, v2: Str) -> List<Adt5> {
    let m358 = f123(v2, v0);
    match m358 {
        None => {
            v1
        }
        Some(v3) => {
            let a359 = v1;
            let a360 = List::cons(v3, List::<Adt5>::nil());
            append_list(a359, a360)
        }
    }
}

pub fn f105(v0: Adt6, v1: Str, v2: List<Adt5>) -> R<Bytes> {
    Ok(f26(List::cons(f29(List::cons(f55(Str::lit("prism-factory/obligation/1")), List::<Bytes>::nil())), List::cons(f29(List::cons(f55(Str::lit("name")), List::cons(f55(match v0.clone() {
        Adt6::C0(h361, _, _, _, _, _) => {
            h361
        }
    }), List::<Bytes>::nil()))), List::cons(f29(List::cons(f55(Str::lit("kind")), List::cons(f55(f124(match v0.clone() {
        Adt6::C0(_, h362, _, _, _, _) => {
            h362
        }
    })), List::<Bytes>::nil()))), List::cons(f29(List::cons(f55(Str::lit("environment")), List::cons(f55(match v0.clone() {
        Adt6::C0(_, _, h363, _, _, _) => {
            h363
        }
    }), List::<Bytes>::nil()))), List::cons(f29(List::cons(f55(Str::lit("run")), List::cons(f55(match v0.clone() {
        Adt6::C0(_, _, _, h364, _, _) => {
            h364
        }
    }), List::<Bytes>::nil()))), List::cons(f125(Str::lit("input"), match v0 {
        Adt6::C0(_, _, _, _, h365, _) => {
            h365
        }
    }), List::cons(f126(v2)?, List::cons(f29(List::cons(f55(Str::lit("closure")), List::cons(f55(v1), List::<Bytes>::nil()))), List::<Bytes>::nil()))))))))))
}

pub fn f106(v0: List<Adt5>, v1: bool, v2: Str) -> bool {
    let m366 = f123(v2, v0);
    match m366 {
        None => {
            false
        }
        Some(_) => {
            v1
        }
    }
}

pub fn f107(v0: Fn19, p370: List<Adt8>, p371: List<Adt5>) -> List<Adt8> {
    let m369 = (p370, p371);
    {
        let mut m369 = m369;
        loop {
            let step = {
                let (v1, v2) = m369;
                let m367 = v2;
                match m367.uncons() {
                    None => {
                        Err::<(List<Adt8>, List<Adt5>), List<Adt8>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt8>, List<Adt5>), List<Adt8>>(({
                            let c368: Fn19 = v0.clone();
                            c368.apply(v1, v3)
                        }, v4))
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

pub fn f108(v0: List<Adt8>, v1: Adt5) -> List<Adt8> {
    let a373 = v0;
    let a374 = List::cons(match v1 {
        Adt5::C0(_, _, h372) => {
            h372
        }
    }, List::<Adt8>::nil());
    append_list(a373, a374)
}

pub fn f109(v0: List<Adt8>) -> bool {
    f127(Fn22::F128, true, v0)
}

pub fn f110(v0: Str, v1: List<(Str, bool)>) -> Option<bool> {
    f129(Fn23::F130(v0), None::<bool>, v1)
}

pub fn f111(v0: Adt6) -> Adt6 {
    Adt6::C0(match v0.clone() {
        Adt6::C0(h375, _, _, _, _, _) => {
            h375
        }
    }, match v0.clone() {
        Adt6::C0(_, h376, _, _, _, _) => {
            h376
        }
    }, Str::lit("prism"), match v0.clone() {
        Adt6::C0(_, _, _, h377, _, _) => {
            h377
        }
    }, match v0.clone() {
        Adt6::C0(_, _, _, _, h378, _) => {
            h378
        }
    }, match v0 {
        Adt6::C0(_, _, _, _, _, h379) => {
            h379
        }
    })
}

pub fn f112(v0: Fn20, p383: (Option<Bytes>, List<Bytes>), p384: List<Bytes>) -> (Option<Bytes>, List<Bytes>) {
    let m382 = (p383, p384);
    {
        let mut m382 = m382;
        loop {
            let step = {
                let (v1, v2) = m382;
                let m380 = v2;
                match m380.uncons() {
                    None => {
                        Err::<((Option<Bytes>, List<Bytes>), List<Bytes>), (Option<Bytes>, List<Bytes>)>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<((Option<Bytes>, List<Bytes>), List<Bytes>), (Option<Bytes>, List<Bytes>)>(({
                            let c381: Fn20 = v0.clone();
                            c381.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m382 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f113(v0: (Option<Bytes>, List<Bytes>), v1: Bytes) -> (Option<Bytes>, List<Bytes>) {
    f131(v0, v1)
}

pub fn f114(v0: List<Str>, v1: Bytes) -> R<bool> {
    let a385 = f132(v0.clone(), v1.clone(), true)?;
    let a386 = f132(v0, v1, false)?;
    Ok(nat_lt(a385, a386))
}

pub fn f115(v0: Fn21, p391: u64, p392: u64) -> R<(u64, bool)> {
    let m390 = (p391, p392);
    {
        let mut m390 = m390;
        loop {
            let step = {
                let (v1, v2) = m390;
                let m387 = v1;
                if m387 == 0 {
                    Err::<(u64, u64), R<(u64, bool)>>(Ok((v2, false)))
                } else {
                    let v3 = m387 - 1;
                    let m389 = {
                        let c388: Fn21 = v0.clone();
                        c388.apply(v2)?
                    };
                    match m389 {
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
                Ok(next) => { m390 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f116(v0: Bytes, v1: u64, v2: Bytes, v3: u64, v4: u64) -> R<Option<u64>> {
    if f117(v2, v0, v4) {
        Ok(None::<u64>)
    } else {
        let a395 = {
            let a393 = v4;
            let a394 = v1;
            nat_add(a393, a394)?
        };
        let a396 = v3;
        if nat_lt(a395, a396) {
            Ok(Some({
                let a397 = v4;
                let a398 = 1u64;
                nat_add(a397, a398)?
            }))
        } else {
            Ok(None::<u64>)
        }
    }
}

pub fn f117(v0: Bytes, v1: Bytes, v2: u64) -> bool {
    let m403 = {
        let a400 = v0;
        let a401 = v2;
        let a402 = {
            let a399 = v1.clone();
            length_bytes(a399)
        };
        slice_bytes(a400, a401, a402)
    };
    match m403 {
        None => {
            false
        }
        Some(v3) => {
            let a404 = v3;
            let a405 = v1;
            equal(a404, a405)
        }
    }
}

pub fn f118(v0: Bytes, v1: Bytes) -> bool {
    let v2: u64 = {
        let a406 = v0.clone();
        length_bytes(a406)
    };
    let v3: u64 = {
        let a407 = v1.clone();
        length_bytes(a407)
    };
    let a408 = v3;
    let a409 = v2;
    if nat_le(a408, a409) {
        let m415 = {
            let a412 = v0;
            let a413 = {
                let a410 = v2;
                let a411 = v3;
                nat_sub(a410, a411)
            };
            let a414 = v3;
            slice_bytes(a412, a413, a414)
        };
        match m415 {
            None => {
                false
            }
            Some(v4) => {
                let a416 = v4;
                let a417 = v1;
                equal(a416, a417)
            }
        }
    } else {
        false
    }
}

pub fn f119(p424: List<Str>, p425: List<Str>) -> bool {
    let m423 = (p424, p425);
    {
        let mut m423 = m423;
        loop {
            let step = {
                let (v0, v1) = m423;
                let m418 = v0;
                match m418.uncons() {
                    None => {
                        let m419 = v1;
                        match m419.uncons() {
                            None => {
                                Err::<(List<Str>, List<Str>), bool>(true)
                            }
                            Some((_, _)) => {
                                Err::<(List<Str>, List<Str>), bool>(false)
                            }
                        }
                    }
                    Some((v4, v5)) => {
                        let m420 = v1;
                        match m420.uncons() {
                            None => {
                                Err::<(List<Str>, List<Str>), bool>(false)
                            }
                            Some((v6, v7)) => {
                                let a421 = v4;
                                let a422 = v6;
                                if equal(a421, a422) {
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
                Ok(next) => { m423 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f120(v0: Adt12) -> Bytes {
    let a446 = f133(match v0.clone() {
        Adt12::C0(h426, _, _, _, _, _, _, _) => {
            h426
        }
    });
    let a447 = {
        let a444 = f133(match v0.clone() {
            Adt12::C0(_, h427, _, _, _, _, _, _) => {
                h427
            }
        });
        let a445 = {
            let a442 = f133(match v0.clone() {
                Adt12::C0(_, _, h428, _, _, _, _, _) => {
                    h428
                }
            });
            let a443 = {
                let a440 = f133(match v0.clone() {
                    Adt12::C0(_, _, _, h429, _, _, _, _) => {
                        h429
                    }
                });
                let a441 = {
                    let a438 = f133(match v0.clone() {
                        Adt12::C0(_, _, _, _, h430, _, _, _) => {
                            h430
                        }
                    });
                    let a439 = {
                        let a436 = f133(match v0.clone() {
                            Adt12::C0(_, _, _, _, _, h431, _, _) => {
                                h431
                            }
                        });
                        let a437 = {
                            let a434 = f133(match v0.clone() {
                                Adt12::C0(_, _, _, _, _, _, h432, _) => {
                                    h432
                                }
                            });
                            let a435 = f133(match v0 {
                                Adt12::C0(_, _, _, _, _, _, _, h433) => {
                                    h433
                                }
                            });
                            append_bytes(a434, a435)
                        };
                        append_bytes(a436, a437)
                    };
                    append_bytes(a438, a439)
                };
                append_bytes(a440, a441)
            };
            append_bytes(a442, a443)
        };
        append_bytes(a444, a445)
    };
    append_bytes(a446, a447)
}

pub fn f121(v0: Bytes) -> R<Adt12> {
    let v1: u64 = {
        let a448 = v0.clone();
        length_bytes(a448)
    };
    let v2: u64 = {
        let a454 = {
            let a451 = {
                let a449 = v1;
                let a450 = 72u64;
                nat_add(a449, a450)?
            };
            let a452 = 64u64;
            let a453 = 0u64;
            nat_quot(a451, a452, a453)
        };
        let a455 = 64u64;
        nat_mul(a454, a455)?
    };
    let (_, h456) = f134(Fn24::F135(v0, v1, v2), {
        let a457 = v2;
        let a458 = 64u64;
        let a459 = 0u64;
        nat_quot(a457, a458, a459)
    }, (0u64, f136()))?;
    Ok(h456)
}

pub fn f122(v0: List<Str>, v1: List<Bytes>, v2: (Bytes, Bytes)) -> R<List<Bytes>> {
    if f114(v0, {
        let (_, h460) = v2.clone();
        h460
    })? {
        Ok(List::cons(f29(List::cons(f55(Str::lit("file")), List::cons({
            let (h461, _) = v2;
            h461
        }, List::cons({
            let (_, h462) = v2;
            h462
        }, List::<Bytes>::nil())))), v1))
    } else {
        Ok(v1)
    }
}

pub fn f123(v0: Str, v1: List<Adt5>) -> Option<Adt5> {
    f137(Fn25::F138(v0), None::<Adt5>, v1)
}

pub fn f124(v0: Adt7) -> Str {
    let m463 = v0;
    match m463 {
        Adt7::C0 => {
            Str::lit("hermetic")
        }
        Adt7::C1 => {
            Str::lit("fetch")
        }
    }
}

pub fn f125(v0: Str, v1: List<Str>) -> Bytes {
    f6(f30(Fn6::F139(v0), List::<Bytes>::nil(), v1))
}

pub fn f126(v0: List<Adt5>) -> R<Bytes> {
    Ok(f6(f7(Fn0::F140, List::<Bytes>::nil(), v0)?))
}

pub fn f127(v0: Fn22, p467: bool, p468: List<Adt8>) -> bool {
    let m466 = (p467, p468);
    {
        let mut m466 = m466;
        loop {
            let step = {
                let (v1, v2) = m466;
                let m464 = v2;
                match m464.uncons() {
                    None => {
                        Err::<(bool, List<Adt8>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<Adt8>), bool>(({
                            let c465: Fn22 = v0.clone();
                            c465.apply(v1, v3)
                        }, v4))
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

pub fn f128(v0: bool, v1: Adt8) -> bool {
    if v0 {
        f92(v1)
    } else {
        false
    }
}

pub fn f129(v0: Fn23, p472: Option<bool>, p473: List<(Str, bool)>) -> Option<bool> {
    let m471 = (p472, p473);
    {
        let mut m471 = m471;
        loop {
            let step = {
                let (v1, v2) = m471;
                let m469 = v2;
                match m469.uncons() {
                    None => {
                        Err::<(Option<bool>, List<(Str, bool)>), Option<bool>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<bool>, List<(Str, bool)>), Option<bool>>(({
                            let c470: Fn23 = v0.clone();
                            c470.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m471 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f130(v0: Str, v1: Option<bool>, v2: (Str, bool)) -> Option<bool> {
    let a475 = {
        let (h474, _) = v2;
        h474
    };
    let a476 = v0;
    if equal(a475, a476) {
        let m477 = v1;
        match m477 {
            None => {
                Some({
                    let (_, h479) = v2;
                    h479
                })
            }
            Some(v3) => {
                Some(if v3 {
                    true
                } else {
                    let (_, h478) = v2;
                    h478
                })
            }
        }
    } else {
        v1
    }
}

pub fn f131(v0: (Option<Bytes>, List<Bytes>), v1: Bytes) -> (Option<Bytes>, List<Bytes>) {
    let m481 = {
        let (h480, _) = v0;
        h480
    };
    match m481 {
        None => {
            (Some(v1), {
                let (_, h482) = v0;
                h482
            })
        }
        Some(v2) => {
            (None::<Bytes>, List::cons({
                let a483 = v2;
                let a484 = v1;
                append_bytes(a483, a484)
            }, {
                let (_, h485) = v0;
                h485
            }))
        }
    }
}

pub fn f132(v0: List<Str>, v1: Bytes, v2: bool) -> R<u64> {
    f141(Fn26::F142(v2, v1), 0u64, v0)
}

pub fn f133(v0: u32) -> Bytes {
    let a514 = f143({
        let a486 = f144(v0, 28u32);
        let a487 = 15u32;
        fixed_u32::bit_and(a486, a487)
    });
    let a515 = {
        let a512 = f143({
            let a488 = f144(v0, 24u32);
            let a489 = 15u32;
            fixed_u32::bit_and(a488, a489)
        });
        let a513 = {
            let a510 = f143({
                let a490 = f144(v0, 20u32);
                let a491 = 15u32;
                fixed_u32::bit_and(a490, a491)
            });
            let a511 = {
                let a508 = f143({
                    let a492 = f144(v0, 16u32);
                    let a493 = 15u32;
                    fixed_u32::bit_and(a492, a493)
                });
                let a509 = {
                    let a506 = f143({
                        let a494 = f144(v0, 12u32);
                        let a495 = 15u32;
                        fixed_u32::bit_and(a494, a495)
                    });
                    let a507 = {
                        let a504 = f143({
                            let a496 = f144(v0, 8u32);
                            let a497 = 15u32;
                            fixed_u32::bit_and(a496, a497)
                        });
                        let a505 = {
                            let a502 = f143({
                                let a498 = f144(v0, 4u32);
                                let a499 = 15u32;
                                fixed_u32::bit_and(a498, a499)
                            });
                            let a503 = f143({
                                let a500 = v0;
                                let a501 = 15u32;
                                fixed_u32::bit_and(a500, a501)
                            });
                            append_bytes(a502, a503)
                        };
                        append_bytes(a504, a505)
                    };
                    append_bytes(a506, a507)
                };
                append_bytes(a508, a509)
            };
            append_bytes(a510, a511)
        };
        append_bytes(a512, a513)
    };
    append_bytes(a514, a515)
}

pub fn f134(v0: Fn24, p519: u64, p520: (u64, Adt12)) -> R<(u64, Adt12)> {
    let m518 = (p519, p520);
    {
        let mut m518 = m518;
        loop {
            let step = {
                let (v1, v2) = m518;
                let m516 = v1;
                if m516 == 0 {
                    Err::<(u64, (u64, Adt12)), R<(u64, Adt12)>>(Ok(v2))
                } else {
                    let v3 = m516 - 1;
                    Ok::<(u64, (u64, Adt12)), R<(u64, Adt12)>>((v3, {
                        let c517: Fn24 = v0.clone();
                        c517.apply(v2)?
                    }))
                }
            };
            match step {
                Ok(next) => { m518 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f135(v0: Bytes, v1: u64, v2: u64, v3: (u64, Adt12)) -> R<(u64, Adt12)> {
    Ok(({
        let a522 = {
            let (h521, _) = v3.clone();
            h521
        };
        let a523 = 64u64;
        nat_add(a522, a523)?
    }, f145({
        let (_, h524) = v3;
        h524
    }, f146(v0, v1, v2, {
        let (h525, _) = v3;
        h525
    })?)?))
}

pub fn f136() -> Adt12 {
    Adt12::C0(1779033703u32, 3144134277u32, 1013904242u32, 2773480762u32, 1359893119u32, 2600822924u32, 528734635u32, 1541459225u32)
}

pub fn f137(v0: Fn25, p529: Option<Adt5>, p530: List<Adt5>) -> Option<Adt5> {
    let m528 = (p529, p530);
    {
        let mut m528 = m528;
        loop {
            let step = {
                let (v1, v2) = m528;
                let m526 = v2;
                match m526.uncons() {
                    None => {
                        Err::<(Option<Adt5>, List<Adt5>), Option<Adt5>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Adt5>, List<Adt5>), Option<Adt5>>(({
                            let c527: Fn25 = v0.clone();
                            c527.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m528 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f138(v0: Str, v1: Option<Adt5>, v2: Adt5) -> Option<Adt5> {
    let a534 = {
        let m533 = match v2.clone() {
            Adt5::C0(h532, _, _) => {
                h532
            }
        };
        match m533 {
            Adt6::C0(h531, _, _, _, _, _) => {
                h531
            }
        }
    };
    let a535 = v0;
    if equal(a534, a535) {
        Some(v2)
    } else {
        v1
    }
}

pub fn f139(v0: Str, v1: List<Bytes>, v2: Str) -> List<Bytes> {
    List::cons(f29(List::cons(f55(v0), List::cons(f55(v2), List::<Bytes>::nil()))), v1)
}

pub fn f140(v0: List<Bytes>, v1: Adt5) -> List<Bytes> {
    List::cons(f29(List::cons(f55(Str::lit("needs")), List::cons(f55({
        let m538 = match v1.clone() {
            Adt5::C0(h537, _, _) => {
                h537
            }
        };
        match m538 {
            Adt6::C0(h536, _, _, _, _, _) => {
                h536
            }
        }
    }), List::cons(f55(match v1 {
        Adt5::C0(_, h539, _) => {
            h539
        }
    }), List::<Bytes>::nil())))), v0)
}

pub fn f141(v0: Fn26, p543: u64, p544: List<Str>) -> R<u64> {
    let m542 = (p543, p544);
    {
        let mut m542 = m542;
        loop {
            let step = {
                let (v1, v2) = m542;
                let m540 = v2;
                match m540.uncons() {
                    None => {
                        Err::<(u64, List<Str>), R<u64>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(u64, List<Str>), R<u64>>(({
                            let c541: Fn26 = v0.clone();
                            c541.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m542 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f142(v0: bool, v1: Bytes, v2: u64, v3: Str) -> R<u64> {
    let a545 = f147(v3.clone(), Bytes::lit(&[0x21]));
    let a546 = v0;
    if equal(a545, a546) {
        let v4: u64 = f148(v3, v1)?;
        let a547 = v2;
        let a548 = v4;
        if nat_lt(a547, a548) {
            Ok(v4)
        } else {
            Ok(v2)
        }
    } else {
        Ok(v2)
    }
}

pub fn f143(v0: u32) -> Bytes {
    let a551 = {
        let a549 = v0;
        let a550 = 8u32;
        fixed_u32::bit_and(a549, a550)
    };
    let a552 = 0u32;
    if equal(a551, a552) {
        let a555 = {
            let a553 = v0;
            let a554 = 4u32;
            fixed_u32::bit_and(a553, a554)
        };
        let a556 = 0u32;
        if equal(a555, a556) {
            let a559 = {
                let a557 = v0;
                let a558 = 2u32;
                fixed_u32::bit_and(a557, a558)
            };
            let a560 = 0u32;
            if equal(a559, a560) {
                let a563 = {
                    let a561 = v0;
                    let a562 = 1u32;
                    fixed_u32::bit_and(a561, a562)
                };
                let a564 = 0u32;
                if equal(a563, a564) {
                    Bytes::lit(&[0x30])
                } else {
                    Bytes::lit(&[0x31])
                }
            } else {
                let a567 = {
                    let a565 = v0;
                    let a566 = 1u32;
                    fixed_u32::bit_and(a565, a566)
                };
                let a568 = 0u32;
                if equal(a567, a568) {
                    Bytes::lit(&[0x32])
                } else {
                    Bytes::lit(&[0x33])
                }
            }
        } else {
            let a571 = {
                let a569 = v0;
                let a570 = 2u32;
                fixed_u32::bit_and(a569, a570)
            };
            let a572 = 0u32;
            if equal(a571, a572) {
                let a575 = {
                    let a573 = v0;
                    let a574 = 1u32;
                    fixed_u32::bit_and(a573, a574)
                };
                let a576 = 0u32;
                if equal(a575, a576) {
                    Bytes::lit(&[0x34])
                } else {
                    Bytes::lit(&[0x35])
                }
            } else {
                let a579 = {
                    let a577 = v0;
                    let a578 = 1u32;
                    fixed_u32::bit_and(a577, a578)
                };
                let a580 = 0u32;
                if equal(a579, a580) {
                    Bytes::lit(&[0x36])
                } else {
                    Bytes::lit(&[0x37])
                }
            }
        }
    } else {
        let a583 = {
            let a581 = v0;
            let a582 = 4u32;
            fixed_u32::bit_and(a581, a582)
        };
        let a584 = 0u32;
        if equal(a583, a584) {
            let a587 = {
                let a585 = v0;
                let a586 = 2u32;
                fixed_u32::bit_and(a585, a586)
            };
            let a588 = 0u32;
            if equal(a587, a588) {
                let a591 = {
                    let a589 = v0;
                    let a590 = 1u32;
                    fixed_u32::bit_and(a589, a590)
                };
                let a592 = 0u32;
                if equal(a591, a592) {
                    Bytes::lit(&[0x38])
                } else {
                    Bytes::lit(&[0x39])
                }
            } else {
                let a595 = {
                    let a593 = v0;
                    let a594 = 1u32;
                    fixed_u32::bit_and(a593, a594)
                };
                let a596 = 0u32;
                if equal(a595, a596) {
                    Bytes::lit(&[0x61])
                } else {
                    Bytes::lit(&[0x62])
                }
            }
        } else {
            let a599 = {
                let a597 = v0;
                let a598 = 2u32;
                fixed_u32::bit_and(a597, a598)
            };
            let a600 = 0u32;
            if equal(a599, a600) {
                let a603 = {
                    let a601 = v0;
                    let a602 = 1u32;
                    fixed_u32::bit_and(a601, a602)
                };
                let a604 = 0u32;
                if equal(a603, a604) {
                    Bytes::lit(&[0x63])
                } else {
                    Bytes::lit(&[0x64])
                }
            } else {
                let a607 = {
                    let a605 = v0;
                    let a606 = 1u32;
                    fixed_u32::bit_and(a605, a606)
                };
                let a608 = 0u32;
                if equal(a607, a608) {
                    Bytes::lit(&[0x65])
                } else {
                    Bytes::lit(&[0x66])
                }
            }
        }
    }
}

pub fn f144(v0: u32, v1: u32) -> u32 {
    let m611 = {
        let a609 = v0;
        let a610 = v1;
        fixed_u32::shift_right(a609, a610)
    };
    match m611 {
        None => {
            0u32
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f145(v0: Adt12, v1: Adt13) -> R<Adt12> {
    let v2: Adt14 = f149(Fn27::F150, 64u64, Adt14::C0(match v0.clone() {
        Adt12::C0(h612, _, _, _, _, _, _, _) => {
            h612
        }
    }, match v0.clone() {
        Adt12::C0(_, h613, _, _, _, _, _, _) => {
            h613
        }
    }, match v0.clone() {
        Adt12::C0(_, _, h614, _, _, _, _, _) => {
            h614
        }
    }, match v0.clone() {
        Adt12::C0(_, _, _, h615, _, _, _, _) => {
            h615
        }
    }, match v0.clone() {
        Adt12::C0(_, _, _, _, h616, _, _, _) => {
            h616
        }
    }, match v0.clone() {
        Adt12::C0(_, _, _, _, _, h617, _, _) => {
            h617
        }
    }, match v0.clone() {
        Adt12::C0(_, _, _, _, _, _, h618, _) => {
            h618
        }
    }, match v0.clone() {
        Adt12::C0(_, _, _, _, _, _, _, h619) => {
            h619
        }
    }, v1, 0u64))?;
    Ok(Adt12::C0(f151(match v0.clone() {
        Adt12::C0(h620, _, _, _, _, _, _, _) => {
            h620
        }
    }, match v2.clone() {
        Adt14::C0(h621, _, _, _, _, _, _, _, _, _) => {
            h621
        }
    }), f151(match v0.clone() {
        Adt12::C0(_, h622, _, _, _, _, _, _) => {
            h622
        }
    }, match v2.clone() {
        Adt14::C0(_, h623, _, _, _, _, _, _, _, _) => {
            h623
        }
    }), f151(match v0.clone() {
        Adt12::C0(_, _, h624, _, _, _, _, _) => {
            h624
        }
    }, match v2.clone() {
        Adt14::C0(_, _, h625, _, _, _, _, _, _, _) => {
            h625
        }
    }), f151(match v0.clone() {
        Adt12::C0(_, _, _, h626, _, _, _, _) => {
            h626
        }
    }, match v2.clone() {
        Adt14::C0(_, _, _, h627, _, _, _, _, _, _) => {
            h627
        }
    }), f151(match v0.clone() {
        Adt12::C0(_, _, _, _, h628, _, _, _) => {
            h628
        }
    }, match v2.clone() {
        Adt14::C0(_, _, _, _, h629, _, _, _, _, _) => {
            h629
        }
    }), f151(match v0.clone() {
        Adt12::C0(_, _, _, _, _, h630, _, _) => {
            h630
        }
    }, match v2.clone() {
        Adt14::C0(_, _, _, _, _, h631, _, _, _, _) => {
            h631
        }
    }), f151(match v0.clone() {
        Adt12::C0(_, _, _, _, _, _, h632, _) => {
            h632
        }
    }, match v2.clone() {
        Adt14::C0(_, _, _, _, _, _, h633, _, _, _) => {
            h633
        }
    }), f151(match v0 {
        Adt12::C0(_, _, _, _, _, _, _, h634) => {
            h634
        }
    }, match v2 {
        Adt14::C0(_, _, _, _, _, _, _, h635, _, _) => {
            h635
        }
    })))
}

pub fn f146(v0: Bytes, v1: u64, v2: u64, v3: u64) -> R<Adt13> {
    Ok(Adt13::C0(f152(v0.clone(), v1, v2, v3)?, f152(v0.clone(), v1, v2, {
        let a636 = v3;
        let a637 = 4u64;
        nat_add(a636, a637)?
    })?, f152(v0.clone(), v1, v2, {
        let a638 = v3;
        let a639 = 8u64;
        nat_add(a638, a639)?
    })?, f152(v0.clone(), v1, v2, {
        let a640 = v3;
        let a641 = 12u64;
        nat_add(a640, a641)?
    })?, f152(v0.clone(), v1, v2, {
        let a642 = v3;
        let a643 = 16u64;
        nat_add(a642, a643)?
    })?, f152(v0.clone(), v1, v2, {
        let a644 = v3;
        let a645 = 20u64;
        nat_add(a644, a645)?
    })?, f152(v0.clone(), v1, v2, {
        let a646 = v3;
        let a647 = 24u64;
        nat_add(a646, a647)?
    })?, f152(v0.clone(), v1, v2, {
        let a648 = v3;
        let a649 = 28u64;
        nat_add(a648, a649)?
    })?, f152(v0.clone(), v1, v2, {
        let a650 = v3;
        let a651 = 32u64;
        nat_add(a650, a651)?
    })?, f152(v0.clone(), v1, v2, {
        let a652 = v3;
        let a653 = 36u64;
        nat_add(a652, a653)?
    })?, f152(v0.clone(), v1, v2, {
        let a654 = v3;
        let a655 = 40u64;
        nat_add(a654, a655)?
    })?, f152(v0.clone(), v1, v2, {
        let a656 = v3;
        let a657 = 44u64;
        nat_add(a656, a657)?
    })?, f152(v0.clone(), v1, v2, {
        let a658 = v3;
        let a659 = 48u64;
        nat_add(a658, a659)?
    })?, f152(v0.clone(), v1, v2, {
        let a660 = v3;
        let a661 = 52u64;
        nat_add(a660, a661)?
    })?, f152(v0.clone(), v1, v2, {
        let a662 = v3;
        let a663 = 56u64;
        nat_add(a662, a663)?
    })?, f152(v0, v1, v2, {
        let a664 = v3;
        let a665 = 60u64;
        nat_add(a664, a665)?
    })?))
}

pub fn f147(v0: Str, v1: Bytes) -> bool {
    f153(f55(v0), v1)
}

pub fn f148(v0: Str, v1: Bytes) -> R<u64> {
    let v2: Bytes = if f147(v0.clone(), Bytes::lit(&[0x21])) {
        f154(v0)
    } else {
        f55(v0)
    };
    if f153(v1.clone(), v2.clone()) {
        if f153(v1, Bytes::lit(&[0x40])) {
            if f153(v2.clone(), Bytes::lit(&[0x40])) {
                let a667 = {
                    let a666 = v2;
                    length_bytes(a666)
                };
                let a668 = 1u64;
                nat_add(a667, a668)
            } else {
                Ok(0u64)
            }
        } else {
            let a670 = {
                let a669 = v2;
                length_bytes(a669)
            };
            let a671 = 1u64;
            nat_add(a670, a671)
        }
    } else {
        Ok(0u64)
    }
}

pub fn f149(v0: Fn27, p675: u64, p676: Adt14) -> R<Adt14> {
    let m674 = (p675, p676);
    {
        let mut m674 = m674;
        loop {
            let step = {
                let (v1, v2) = m674;
                let m672 = v1;
                if m672 == 0 {
                    Err::<(u64, Adt14), R<Adt14>>(Ok(v2))
                } else {
                    let v3 = m672 - 1;
                    Ok::<(u64, Adt14), R<Adt14>>((v3, {
                        let c673: Fn27 = v0.clone();
                        c673.apply(v2)?
                    }))
                }
            };
            match step {
                Ok(next) => { m674 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f150(v0: Adt14) -> R<Adt14> {
    f155(v0)
}

pub fn f151(v0: u32, v1: u32) -> u32 {
    let m679 = {
        let a677 = f156(v0);
        let a678 = f156(v1);
        fixed_u64::checked_add(a677, a678)
    };
    match m679 {
        None => {
            0u32
        }
        Some(v2) => {
            f157(v2)
        }
    }
}

pub fn f152(v0: Bytes, v1: u64, v2: u64, v3: u64) -> R<u32> {
    let a682 = {
        let a680 = v3;
        let a681 = 8u64;
        nat_add(a680, a681)?
    };
    let a683 = v2;
    if nat_eq(a682, a683) {
        Ok(f158({
            let a686 = {
                let a684 = v1;
                let a685 = 8u64;
                nat_mul(a684, a685)?
            };
            let a687 = 4294967296u64;
            let a688 = 0u64;
            nat_quot(a686, a687, a688)
        }))
    } else {
        let a691 = {
            let a689 = v3;
            let a690 = 4u64;
            nat_add(a689, a690)?
        };
        let a692 = v2;
        if nat_eq(a691, a692) {
            Ok(f158({
                let a695 = {
                    let a693 = v1;
                    let a694 = 8u64;
                    nat_mul(a693, a694)?
                };
                let a696 = 4294967296u64;
                let a697 = 0u64;
                nat_rem(a695, a696, a697)
            }))
        } else {
            Ok(f159(f160(v0.clone(), v1, v3), f160(v0.clone(), v1, {
                let a698 = v3;
                let a699 = 1u64;
                nat_add(a698, a699)?
            }), f160(v0.clone(), v1, {
                let a700 = v3;
                let a701 = 2u64;
                nat_add(a700, a701)?
            }), f160(v0, v1, {
                let a702 = v3;
                let a703 = 3u64;
                nat_add(a702, a703)?
            })))
        }
    }
}

pub fn f153(v0: Bytes, v1: Bytes) -> bool {
    let m708 = {
        let a705 = v0;
        let a706 = 0u64;
        let a707 = {
            let a704 = v1.clone();
            length_bytes(a704)
        };
        slice_bytes(a705, a706, a707)
    };
    match m708 {
        None => {
            false
        }
        Some(v2) => {
            let a709 = v2;
            let a710 = v1;
            equal(a709, a710)
        }
    }
}

pub fn f154(v0: Str) -> Bytes {
    let v1: Bytes = f55(v0);
    f37(v1.clone(), 1u64, {
        let a712 = {
            let a711 = v1;
            length_bytes(a711)
        };
        let a713 = 1u64;
        nat_sub(a712, a713)
    })
}

pub fn f155(v0: Adt14) -> R<Adt14> {
    let v1: u32 = f161(match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, h714) => {
            h714
        }
    });
    let v2: u32 = f151(match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, h715, _, _) => {
            h715
        }
    }, f151(f162(match v0.clone() {
        Adt14::C0(_, _, _, _, h716, _, _, _, _, _) => {
            h716
        }
    }), f151(f163(match v0.clone() {
        Adt14::C0(_, _, _, _, h717, _, _, _, _, _) => {
            h717
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, h718, _, _, _, _) => {
            h718
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, h719, _, _, _) => {
            h719
        }
    }), f151(v1, {
        let m722 = match v0.clone() {
            Adt14::C0(_, _, _, _, _, _, _, _, h721, _) => {
                h721
            }
        };
        match m722 {
            Adt13::C0(h720, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h720
            }
        }
    }))));
    let v3: u32 = f151(f164(match v0.clone() {
        Adt14::C0(h723, _, _, _, _, _, _, _, _, _) => {
            h723
        }
    }), f165(match v0.clone() {
        Adt14::C0(h724, _, _, _, _, _, _, _, _, _) => {
            h724
        }
    }, match v0.clone() {
        Adt14::C0(_, h725, _, _, _, _, _, _, _, _) => {
            h725
        }
    }, match v0.clone() {
        Adt14::C0(_, _, h726, _, _, _, _, _, _, _) => {
            h726
        }
    }));
    Ok(Adt14::C0(f151(v2, v3), match v0.clone() {
        Adt14::C0(h727, _, _, _, _, _, _, _, _, _) => {
            h727
        }
    }, match v0.clone() {
        Adt14::C0(_, h728, _, _, _, _, _, _, _, _) => {
            h728
        }
    }, match v0.clone() {
        Adt14::C0(_, _, h729, _, _, _, _, _, _, _) => {
            h729
        }
    }, f151(match v0.clone() {
        Adt14::C0(_, _, _, h730, _, _, _, _, _, _) => {
            h730
        }
    }, v2), match v0.clone() {
        Adt14::C0(_, _, _, _, h731, _, _, _, _, _) => {
            h731
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, h732, _, _, _, _) => {
            h732
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, h733, _, _, _) => {
            h733
        }
    }, f166(match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, h734, _) => {
            h734
        }
    }), {
        let a736 = match v0 {
            Adt14::C0(_, _, _, _, _, _, _, _, _, h735) => {
                h735
            }
        };
        let a737 = 1u64;
        nat_add(a736, a737)?
    }))
}

pub fn f156(v0: u32) -> u64 {
    let m739 = {
        let a738 = v0;
        fixed_u64::convert(i128::from(a738))
    };
    match m739 {
        None => {
            0u64
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f157(v0: u64) -> u32 {
    let m743 = {
        let a742 = {
            let a740 = v0;
            let a741 = 4294967295u64;
            fixed_u64::bit_and(a740, a741)
        };
        fixed_u32::convert(i128::from(a742))
    };
    match m743 {
        None => {
            0u32
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f158(v0: u64) -> u32 {
    let (_, h744) = {
        let (_, h745) = f167(Fn28::F168, 32u64, (v0, (1u32, 0u32)));
        h745
    };
    h744
}

pub fn f159(v0: u32, v1: u32, v2: u32, v3: u32) -> u32 {
    let a750 = f169(v0, 24u32);
    let a751 = {
        let a748 = f169(v1, 16u32);
        let a749 = {
            let a746 = f169(v2, 8u32);
            let a747 = v3;
            fixed_u32::bit_or(a746, a747)
        };
        fixed_u32::bit_or(a748, a749)
    };
    fixed_u32::bit_or(a750, a751)
}

pub fn f160(v0: Bytes, v1: u64, v2: u64) -> u32 {
    let a752 = v2;
    let a753 = v1;
    if nat_lt(a752, a753) {
        let m756 = {
            let a754 = v0;
            let a755 = v2;
            index_bytes(a754, a755)
        };
        match m756 {
            None => {
                0u32
            }
            Some(v3) => {
                let m758 = {
                    let a757 = v3;
                    fixed_u32::convert(i128::from(a757))
                };
                match m758 {
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
        let a759 = v2;
        let a760 = v1;
        if nat_eq(a759, a760) {
            128u32
        } else {
            0u32
        }
    }
}

pub fn f161(v0: u64) -> u32 {
    let a761 = v0;
    let a762 = 32u64;
    if nat_lt(a761, a762) {
        let a763 = v0;
        let a764 = 16u64;
        if nat_lt(a763, a764) {
            let a765 = v0;
            let a766 = 8u64;
            if nat_lt(a765, a766) {
                let a767 = v0;
                let a768 = 4u64;
                if nat_lt(a767, a768) {
                    let a769 = v0;
                    let a770 = 2u64;
                    if nat_lt(a769, a770) {
                        let a771 = v0;
                        let a772 = 1u64;
                        if nat_lt(a771, a772) {
                            1116352408u32
                        } else {
                            1899447441u32
                        }
                    } else {
                        let a773 = v0;
                        let a774 = 3u64;
                        if nat_lt(a773, a774) {
                            3049323471u32
                        } else {
                            3921009573u32
                        }
                    }
                } else {
                    let a775 = v0;
                    let a776 = 6u64;
                    if nat_lt(a775, a776) {
                        let a777 = v0;
                        let a778 = 5u64;
                        if nat_lt(a777, a778) {
                            961987163u32
                        } else {
                            1508970993u32
                        }
                    } else {
                        let a779 = v0;
                        let a780 = 7u64;
                        if nat_lt(a779, a780) {
                            2453635748u32
                        } else {
                            2870763221u32
                        }
                    }
                }
            } else {
                let a781 = v0;
                let a782 = 12u64;
                if nat_lt(a781, a782) {
                    let a783 = v0;
                    let a784 = 10u64;
                    if nat_lt(a783, a784) {
                        let a785 = v0;
                        let a786 = 9u64;
                        if nat_lt(a785, a786) {
                            3624381080u32
                        } else {
                            310598401u32
                        }
                    } else {
                        let a787 = v0;
                        let a788 = 11u64;
                        if nat_lt(a787, a788) {
                            607225278u32
                        } else {
                            1426881987u32
                        }
                    }
                } else {
                    let a789 = v0;
                    let a790 = 14u64;
                    if nat_lt(a789, a790) {
                        let a791 = v0;
                        let a792 = 13u64;
                        if nat_lt(a791, a792) {
                            1925078388u32
                        } else {
                            2162078206u32
                        }
                    } else {
                        let a793 = v0;
                        let a794 = 15u64;
                        if nat_lt(a793, a794) {
                            2614888103u32
                        } else {
                            3248222580u32
                        }
                    }
                }
            }
        } else {
            let a795 = v0;
            let a796 = 24u64;
            if nat_lt(a795, a796) {
                let a797 = v0;
                let a798 = 20u64;
                if nat_lt(a797, a798) {
                    let a799 = v0;
                    let a800 = 18u64;
                    if nat_lt(a799, a800) {
                        let a801 = v0;
                        let a802 = 17u64;
                        if nat_lt(a801, a802) {
                            3835390401u32
                        } else {
                            4022224774u32
                        }
                    } else {
                        let a803 = v0;
                        let a804 = 19u64;
                        if nat_lt(a803, a804) {
                            264347078u32
                        } else {
                            604807628u32
                        }
                    }
                } else {
                    let a805 = v0;
                    let a806 = 22u64;
                    if nat_lt(a805, a806) {
                        let a807 = v0;
                        let a808 = 21u64;
                        if nat_lt(a807, a808) {
                            770255983u32
                        } else {
                            1249150122u32
                        }
                    } else {
                        let a809 = v0;
                        let a810 = 23u64;
                        if nat_lt(a809, a810) {
                            1555081692u32
                        } else {
                            1996064986u32
                        }
                    }
                }
            } else {
                let a811 = v0;
                let a812 = 28u64;
                if nat_lt(a811, a812) {
                    let a813 = v0;
                    let a814 = 26u64;
                    if nat_lt(a813, a814) {
                        let a815 = v0;
                        let a816 = 25u64;
                        if nat_lt(a815, a816) {
                            2554220882u32
                        } else {
                            2821834349u32
                        }
                    } else {
                        let a817 = v0;
                        let a818 = 27u64;
                        if nat_lt(a817, a818) {
                            2952996808u32
                        } else {
                            3210313671u32
                        }
                    }
                } else {
                    let a819 = v0;
                    let a820 = 30u64;
                    if nat_lt(a819, a820) {
                        let a821 = v0;
                        let a822 = 29u64;
                        if nat_lt(a821, a822) {
                            3336571891u32
                        } else {
                            3584528711u32
                        }
                    } else {
                        let a823 = v0;
                        let a824 = 31u64;
                        if nat_lt(a823, a824) {
                            113926993u32
                        } else {
                            338241895u32
                        }
                    }
                }
            }
        }
    } else {
        let a825 = v0;
        let a826 = 48u64;
        if nat_lt(a825, a826) {
            let a827 = v0;
            let a828 = 40u64;
            if nat_lt(a827, a828) {
                let a829 = v0;
                let a830 = 36u64;
                if nat_lt(a829, a830) {
                    let a831 = v0;
                    let a832 = 34u64;
                    if nat_lt(a831, a832) {
                        let a833 = v0;
                        let a834 = 33u64;
                        if nat_lt(a833, a834) {
                            666307205u32
                        } else {
                            773529912u32
                        }
                    } else {
                        let a835 = v0;
                        let a836 = 35u64;
                        if nat_lt(a835, a836) {
                            1294757372u32
                        } else {
                            1396182291u32
                        }
                    }
                } else {
                    let a837 = v0;
                    let a838 = 38u64;
                    if nat_lt(a837, a838) {
                        let a839 = v0;
                        let a840 = 37u64;
                        if nat_lt(a839, a840) {
                            1695183700u32
                        } else {
                            1986661051u32
                        }
                    } else {
                        let a841 = v0;
                        let a842 = 39u64;
                        if nat_lt(a841, a842) {
                            2177026350u32
                        } else {
                            2456956037u32
                        }
                    }
                }
            } else {
                let a843 = v0;
                let a844 = 44u64;
                if nat_lt(a843, a844) {
                    let a845 = v0;
                    let a846 = 42u64;
                    if nat_lt(a845, a846) {
                        let a847 = v0;
                        let a848 = 41u64;
                        if nat_lt(a847, a848) {
                            2730485921u32
                        } else {
                            2820302411u32
                        }
                    } else {
                        let a849 = v0;
                        let a850 = 43u64;
                        if nat_lt(a849, a850) {
                            3259730800u32
                        } else {
                            3345764771u32
                        }
                    }
                } else {
                    let a851 = v0;
                    let a852 = 46u64;
                    if nat_lt(a851, a852) {
                        let a853 = v0;
                        let a854 = 45u64;
                        if nat_lt(a853, a854) {
                            3516065817u32
                        } else {
                            3600352804u32
                        }
                    } else {
                        let a855 = v0;
                        let a856 = 47u64;
                        if nat_lt(a855, a856) {
                            4094571909u32
                        } else {
                            275423344u32
                        }
                    }
                }
            }
        } else {
            let a857 = v0;
            let a858 = 56u64;
            if nat_lt(a857, a858) {
                let a859 = v0;
                let a860 = 52u64;
                if nat_lt(a859, a860) {
                    let a861 = v0;
                    let a862 = 50u64;
                    if nat_lt(a861, a862) {
                        let a863 = v0;
                        let a864 = 49u64;
                        if nat_lt(a863, a864) {
                            430227734u32
                        } else {
                            506948616u32
                        }
                    } else {
                        let a865 = v0;
                        let a866 = 51u64;
                        if nat_lt(a865, a866) {
                            659060556u32
                        } else {
                            883997877u32
                        }
                    }
                } else {
                    let a867 = v0;
                    let a868 = 54u64;
                    if nat_lt(a867, a868) {
                        let a869 = v0;
                        let a870 = 53u64;
                        if nat_lt(a869, a870) {
                            958139571u32
                        } else {
                            1322822218u32
                        }
                    } else {
                        let a871 = v0;
                        let a872 = 55u64;
                        if nat_lt(a871, a872) {
                            1537002063u32
                        } else {
                            1747873779u32
                        }
                    }
                }
            } else {
                let a873 = v0;
                let a874 = 60u64;
                if nat_lt(a873, a874) {
                    let a875 = v0;
                    let a876 = 58u64;
                    if nat_lt(a875, a876) {
                        let a877 = v0;
                        let a878 = 57u64;
                        if nat_lt(a877, a878) {
                            1955562222u32
                        } else {
                            2024104815u32
                        }
                    } else {
                        let a879 = v0;
                        let a880 = 59u64;
                        if nat_lt(a879, a880) {
                            2227730452u32
                        } else {
                            2361852424u32
                        }
                    }
                } else {
                    let a881 = v0;
                    let a882 = 62u64;
                    if nat_lt(a881, a882) {
                        let a883 = v0;
                        let a884 = 61u64;
                        if nat_lt(a883, a884) {
                            2428436474u32
                        } else {
                            2756734187u32
                        }
                    } else {
                        let a885 = v0;
                        let a886 = 63u64;
                        if nat_lt(a885, a886) {
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

pub fn f162(v0: u32) -> u32 {
    let a889 = {
        let a887 = f170(v0, 6u32, 26u32);
        let a888 = f170(v0, 11u32, 21u32);
        fixed_u32::bit_xor(a887, a888)
    };
    let a890 = f170(v0, 25u32, 7u32);
    fixed_u32::bit_xor(a889, a890)
}

pub fn f163(v0: u32, v1: u32, v2: u32) -> u32 {
    let a896 = {
        let a891 = v0;
        let a892 = v1;
        fixed_u32::bit_and(a891, a892)
    };
    let a897 = {
        let a894 = {
            let a893 = v0;
            fixed_u32::bit_not(a893)
        };
        let a895 = v2;
        fixed_u32::bit_and(a894, a895)
    };
    fixed_u32::bit_xor(a896, a897)
}

pub fn f164(v0: u32) -> u32 {
    let a900 = {
        let a898 = f170(v0, 2u32, 30u32);
        let a899 = f170(v0, 13u32, 19u32);
        fixed_u32::bit_xor(a898, a899)
    };
    let a901 = f170(v0, 22u32, 10u32);
    fixed_u32::bit_xor(a900, a901)
}

pub fn f165(v0: u32, v1: u32, v2: u32) -> u32 {
    let a910 = {
        let a906 = {
            let a902 = v0;
            let a903 = v1;
            fixed_u32::bit_and(a902, a903)
        };
        let a907 = {
            let a904 = v0;
            let a905 = v2;
            fixed_u32::bit_and(a904, a905)
        };
        fixed_u32::bit_xor(a906, a907)
    };
    let a911 = {
        let a908 = v1;
        let a909 = v2;
        fixed_u32::bit_and(a908, a909)
    };
    fixed_u32::bit_xor(a910, a911)
}

pub fn f166(v0: Adt13) -> Adt13 {
    Adt13::C0(match v0.clone() {
        Adt13::C0(_, h912, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h912
        }
    }, match v0.clone() {
        Adt13::C0(_, _, h913, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h913
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, h914, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h914
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, h915, _, _, _, _, _, _, _, _, _, _, _) => {
            h915
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, h916, _, _, _, _, _, _, _, _, _, _) => {
            h916
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, h917, _, _, _, _, _, _, _, _, _) => {
            h917
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, h918, _, _, _, _, _, _, _, _) => {
            h918
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, h919, _, _, _, _, _, _, _) => {
            h919
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, h920, _, _, _, _, _, _) => {
            h920
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, h921, _, _, _, _, _) => {
            h921
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, h922, _, _, _, _) => {
            h922
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, _, h923, _, _, _) => {
            h923
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, h924, _, _) => {
            h924
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h925, _) => {
            h925
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h926) => {
            h926
        }
    }, f151(f171(match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h927, _) => {
            h927
        }
    }), f151(match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, h928, _, _, _, _, _, _) => {
            h928
        }
    }, f151(f172(match v0.clone() {
        Adt13::C0(_, h929, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h929
        }
    }), match v0 {
        Adt13::C0(h930, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h930
        }
    }))))
}

pub fn f167(v0: Fn28, p934: u64, p935: (u64, (u32, u32))) -> (u64, (u32, u32)) {
    let m933 = (p934, p935);
    {
        let mut m933 = m933;
        loop {
            let step = {
                let (v1, v2) = m933;
                let m931 = v1;
                if m931 == 0 {
                    Err::<(u64, (u64, (u32, u32))), (u64, (u32, u32))>(v2)
                } else {
                    let v3 = m931 - 1;
                    Ok::<(u64, (u64, (u32, u32))), (u64, (u32, u32))>((v3, {
                        let c932: Fn28 = v0.clone();
                        c932.apply(v2)
                    }))
                }
            };
            match step {
                Ok(next) => { m933 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f168(v0: (u64, (u32, u32))) -> (u64, (u32, u32)) {
    let v1: u64 = {
        let (h936, _) = v0;
        h936
    };
    let v2: u32 = {
        let (h937, _) = {
            let (_, h938) = v0;
            h938
        };
        h937
    };
    let v3: u32 = {
        let (_, h939) = {
            let (_, h940) = v0;
            h940
        };
        h939
    };
    ({
        let a941 = v1;
        let a942 = 2u64;
        let a943 = 0u64;
        nat_quot(a941, a942, a943)
    }, (f169(v2, 1u32), {
        let a947 = {
            let a944 = v1;
            let a945 = 2u64;
            let a946 = 0u64;
            nat_rem(a944, a945, a946)
        };
        let a948 = 1u64;
        if nat_eq(a947, a948) {
            let a949 = v3;
            let a950 = v2;
            fixed_u32::bit_or(a949, a950)
        } else {
            v3
        }
    }))
}

pub fn f169(v0: u32, v1: u32) -> u32 {
    let m953 = {
        let a951 = v0;
        let a952 = v1;
        fixed_u32::shift_left(a951, a952)
    };
    match m953 {
        None => {
            0u32
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f170(v0: u32, v1: u32, v2: u32) -> u32 {
    let a954 = f144(v0, v1);
    let a955 = f169(v0, v2);
    fixed_u32::bit_or(a954, a955)
}

pub fn f171(v0: u32) -> u32 {
    let a958 = {
        let a956 = f170(v0, 17u32, 15u32);
        let a957 = f170(v0, 19u32, 13u32);
        fixed_u32::bit_xor(a956, a957)
    };
    let a959 = f144(v0, 10u32);
    fixed_u32::bit_xor(a958, a959)
}

pub fn f172(v0: u32) -> u32 {
    let a962 = {
        let a960 = f170(v0, 7u32, 25u32);
        let a961 = f170(v0, 18u32, 14u32);
        fixed_u32::bit_xor(a960, a961)
    };
    let a963 = f144(v0, 3u32);
    fixed_u32::bit_xor(a962, a963)
}

pub fn run(p0: Bytes) -> R<Bytes> {
    f0(p0)
}
