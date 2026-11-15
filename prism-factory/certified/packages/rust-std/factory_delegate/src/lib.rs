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
    C3,
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
    F8(List<(Str, bool)>, Adt0, List<Str>),
    F146,
}

impl Fn0 {
    pub fn apply(&self, p0: List<Bytes>, p1: Adt5) -> R<List<Bytes>> {
        match self {
            Fn0::F8(k0, k1, k2) => f8(k0.clone(), k1.clone(), k2.clone(), p0, p1),
            Fn0::F146 => Ok(f146(p0, p1)),
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
    F20(Adt9),
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
    pub fn apply(&self, p0: (List<Adt5>, List<(List<Str>, Str)>), p1: Adt6) -> R<(List<Adt5>, List<(List<Str>, Str)>)> {
        match self {
            Fn4::F22(k0, k1) => f22(k0.clone(), k1.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn5 {
    F24,
    F101,
}

impl Fn5 {
    pub fn apply(&self, p0: List<Adt6>, p1: Adt6) -> List<Adt6> {
        match self {
            Fn5::F24 => f24(p0, p1),
            Fn5::F101 => f101(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn6 {
    F31,
    F145(Str),
}

impl Fn6 {
    pub fn apply(&self, p0: List<Bytes>, p1: Str) -> List<Bytes> {
        match self {
            Fn6::F31 => f31(p0, p1),
            Fn6::F145(k0) => f145(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn7 {
    F33(List<(Str, bool)>, List<Str>),
}

impl Fn7 {
    pub fn apply(&self, p0: Str, p1: Adt5) -> Str {
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
    F71,
    F74,
}

impl Fn12 {
    pub fn apply(&self, p0: List<Str>, p1: Adt6) -> List<Str> {
        match self {
            Fn12::F71 => f71(p0, p1),
            Fn12::F74 => f74(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn13 {
    F85(Str),
}

impl Fn13 {
    pub fn apply(&self, p0: Adt10, p1: (Str, Adt10)) -> Adt10 {
        match self {
            Fn13::F85(k0) => f85(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn14 {
    F90(Str),
    F110(List<Adt5>),
}

impl Fn14 {
    pub fn apply(&self, p0: bool, p1: Str) -> bool {
        match self {
            Fn14::F90(k0) => f90(k0.clone(), p0, p1),
            Fn14::F110(k0) => f110(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn15 {
    F92(List<Str>, Str),
    F128(List<Str>),
}

impl Fn15 {
    pub fn apply(&self, p0: List<Bytes>, p1: (Bytes, Bytes)) -> R<List<Bytes>> {
        match self {
            Fn15::F92(k0, k1) => f92(k0.clone(), k1.clone(), p0, p1),
            Fn15::F128(k0) => f128(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn16 {
    F96(Bytes),
}

impl Fn16 {
    pub fn apply(&self, p0: Option<Bytes>, p1: Bytes) -> Option<Bytes> {
        match self {
            Fn16::F96(k0) => f96(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn17 {
    F104(List<Str>),
}

impl Fn17 {
    pub fn apply(&self, p0: Option<Str>, p1: (List<Str>, Str)) -> Option<Str> {
        match self {
            Fn17::F104(k0) => f104(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn18 {
    F108(List<Adt5>),
}

impl Fn18 {
    pub fn apply(&self, p0: List<Adt5>, p1: Str) -> List<Adt5> {
        match self {
            Fn18::F108(k0) => f108(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn19 {
    F112,
}

impl Fn19 {
    pub fn apply(&self, p0: List<Adt8>, p1: Adt5) -> List<Adt8> {
        match self {
            Fn19::F112 => f112(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn20 {
    F116,
}

impl Fn20 {
    pub fn apply(&self, p0: (Option<Bytes>, List<Bytes>), p1: Bytes) -> (Option<Bytes>, List<Bytes>) {
        match self {
            Fn20::F116 => f116(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn21 {
    F119(Str),
}

impl Fn21 {
    pub fn apply(&self, p0: bool, p1: (Str, bool)) -> bool {
        match self {
            Fn21::F119(k0) => f119(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn22 {
    F121(Bytes, u64, Bytes, u64),
}

impl Fn22 {
    pub fn apply(&self, p0: u64) -> R<Option<u64>> {
        match self {
            Fn22::F121(k0, k1, k2, k3) => f121(k0.clone(), *k1, k2.clone(), *k3, p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn23 {
    F134,
}

impl Fn23 {
    pub fn apply(&self, p0: bool, p1: Adt8) -> bool {
        match self {
            Fn23::F134 => f134(p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn24 {
    F136(Str),
}

impl Fn24 {
    pub fn apply(&self, p0: Option<bool>, p1: (Str, bool)) -> Option<bool> {
        match self {
            Fn24::F136(k0) => f136(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn25 {
    F141(Bytes, u64, u64),
}

impl Fn25 {
    pub fn apply(&self, p0: (u64, Adt12)) -> R<(u64, Adt12)> {
        match self {
            Fn25::F141(k0, k1, k2) => f141(k0.clone(), *k1, *k2, p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn26 {
    F144(Str),
}

impl Fn26 {
    pub fn apply(&self, p0: Option<Adt5>, p1: Adt5) -> Option<Adt5> {
        match self {
            Fn26::F144(k0) => f144(k0.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn27 {
    F148(bool, Bytes),
}

impl Fn27 {
    pub fn apply(&self, p0: u64, p1: Str) -> R<u64> {
        match self {
            Fn27::F148(k0, k1) => f148(*k0, k1.clone(), p0, p1),
        }
    }
}

#[derive(Clone)]
pub enum Fn28 {
    F156,
}

impl Fn28 {
    pub fn apply(&self, p0: Adt14) -> R<Adt14> {
        match self {
            Fn28::F156 => f156(p0),
        }
    }
}

#[derive(Clone)]
pub enum Fn29 {
    F174,
}

impl Fn29 {
    pub fn apply(&self, p0: (u64, (u32, u32))) -> (u64, (u32, u32)) {
        match self {
            Fn29::F174 => f174(p0),
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
    let v3: List<(Str, bool)> = f3(v1.clone());
    let v4: List<Adt5> = f4(f5(), match v1.clone() {
        Adt0::C0(h2, _, _, _, _) => {
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

pub fn f3(v0: Adt0) -> List<(Str, bool)> {
    let v1: Adt9 = Adt9::C0(match v0.clone() {
        Adt0::C0(_, _, h12, _, _) => {
            h12
        }
    }, match v0.clone() {
        Adt0::C0(_, _, _, h13, _) => {
            h13
        }
    });
    f19(Fn3::F20(v1), List::<(Str, bool)>::nil(), match v0 {
        Adt0::C0(_, h14, _, _, _) => {
            h14
        }
    })
}

pub fn f4(v0: List<Adt6>, v1: List<(Bytes, Bytes)>, v2: List<(Str, bool)>) -> R<List<Adt5>> {
    let (h15, _) = f21(Fn4::F22(v2, v1), (List::<Adt5>::nil(), List::<(List<Str>, Str)>::nil()), v0)?;
    Ok(h15)
}

pub fn f5() -> List<Adt6> {
    f23(Fn5::F24, List::<Adt6>::nil(), f25())
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

pub fn f8(v0: List<(Str, bool)>, v1: Adt0, v2: List<Str>, v3: List<Bytes>, v4: Adt5) -> R<List<Bytes>> {
    Ok(List::cons(f28(v4, v2, match v1 {
        Adt0::C0(h21, _, _, _, _) => {
            h21
        }
    }, v0)?, v3))
}

pub fn f9(v0: List<Str>) -> Bytes {
    f29(f30(Fn6::F31, List::<Bytes>::nil(), v0))
}

pub fn f10() -> Str {
    Str::lit("ghcr.io/uor-foundation/prismpm-sdk@sha256:d6c263a733a6bc36e0458c3f5b9a1f5ea9c14dfbe8c257d3f650a960b5fe633c")
}

pub fn f11(v0: List<Adt5>, v1: List<Str>, v2: List<(Str, bool)>) -> Str {
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
            let a45 = f41(f42());
            let a46 = f43(f44());
            append_list(a45, a46)
        }
        Adt4::C1 => {
            f43(f25())
        }
        Adt4::C2 => {
            f43(f25())
        }
        Adt4::C3 => {
            f43(f25())
        }
    }
}

pub fn f19(v0: Fn3, p50: List<(Str, bool)>, p51: List<Adt1>) -> List<(Str, bool)> {
    let m49 = (p50, p51);
    {
        let mut m49 = m49;
        loop {
            let step = {
                let (v1, v2) = m49;
                let m47 = v2;
                match m47.uncons() {
                    None => {
                        Err::<(List<(Str, bool)>, List<Adt1>), List<(Str, bool)>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<(Str, bool)>, List<Adt1>), List<(Str, bool)>>(({
                            let c48: Fn3 = v0.clone();
                            c48.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m49 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f20(v0: Adt9, v1: List<(Str, bool)>, v2: Adt1) -> List<(Str, bool)> {
    if f45(v2.clone(), v0) {
        List::cons((match v2.clone() {
            Adt1::C0(_, h52, _, _, _, _) => {
                h52
            }
        }, match v2 {
            Adt1::C0(_, _, h53, _, _, _) => {
                h53
            }
        }), v1)
    } else {
        v1
    }
}

pub fn f21(v0: Fn4, p57: (List<Adt5>, List<(List<Str>, Str)>), p58: List<Adt6>) -> R<(List<Adt5>, List<(List<Str>, Str)>)> {
    let m56 = (p57, p58);
    {
        let mut m56 = m56;
        loop {
            let step = {
                let (v1, v2) = m56;
                let m54 = v2;
                match m54.uncons() {
                    None => {
                        Err::<((List<Adt5>, List<(List<Str>, Str)>), List<Adt6>), R<(List<Adt5>, List<(List<Str>, Str)>)>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<((List<Adt5>, List<(List<Str>, Str)>), List<Adt6>), R<(List<Adt5>, List<(List<Str>, Str)>)>>(({
                            let c55: Fn4 = v0.clone();
                            c55.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m56 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f22(v0: List<(Str, bool)>, v1: List<(Bytes, Bytes)>, v2: (List<Adt5>, List<(List<Str>, Str)>), v3: Adt6) -> R<(List<Adt5>, List<(List<Str>, Str)>)> {
    f46(v1, v0, v2, v3)
}

pub fn f23(v0: Fn5, p62: List<Adt6>, p63: List<Adt6>) -> List<Adt6> {
    let m61 = (p62, p63);
    {
        let mut m61 = m61;
        loop {
            let step = {
                let (v1, v2) = m61;
                let m59 = v2;
                match m59.uncons() {
                    None => {
                        Err::<(List<Adt6>, List<Adt6>), List<Adt6>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt6>, List<Adt6>), List<Adt6>>(({
                            let c60: Fn5 = v0.clone();
                            c60.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m61 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f24(v0: List<Adt6>, v1: Adt6) -> List<Adt6> {
    let a64 = v0;
    let a65 = List::cons(f47(v1), List::<Adt6>::nil());
    append_list(a64, a65)
}

pub fn f25() -> List<Adt6> {
    let a66 = f42();
    let a67 = f44();
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

pub fn f28(v0: Adt5, v1: List<Str>, v2: List<(Bytes, Bytes)>, v3: List<(Str, bool)>) -> R<Bytes> {
    let v4: Adt6 = match v0.clone() {
        Adt5::C0(h71, _, _) => {
            h71
        }
    };
    let v5: Str = match v4.clone() {
        Adt6::C0(h72, _, _, _, _, _) => {
            h72
        }
    };
    let v6: Adt10 = f52(v5.clone());
    let v7: Bytes = {
        let a80 = {
            let a76 = f9(List::cons(Str::lit("obligation"), List::cons(v5.clone(), List::cons(f53(match v0.clone() {
                Adt5::C0(_, _, h73) => {
                    h73
                }
            }), List::cons(match v0.clone() {
                Adt5::C0(_, h74, _) => {
                    h74
                }
            }, List::<Str>::nil())))));
            let a77 = f9(List::cons(Str::lit("run"), List::cons(v5.clone(), List::cons(match v4.clone() {
                Adt6::C0(_, _, _, h75, _, _) => {
                    h75
                }
            }, List::<Str>::nil()))));
            append_bytes(a76, a77)
        };
        let a81 = f9(List::cons(Str::lit("access"), List::cons(v5.clone(), List::cons(f54(match v6.clone() {
            Adt10::C0(_, _, _, _, _, h78) => {
                h78
            }
        }), List::cons(match v6 {
            Adt10::C0(h79, _, _, _, _, _) => {
                h79
            }
        }, List::<Str>::nil())))));
        append_bytes(a80, a81)
    };
    let v8: Bytes = f29(List::cons(f55(Str::lit("sandbox")), List::cons(f55(v5.clone()), List::cons(f56(v5.clone()), List::<Bytes>::nil()))));
    let v9: bool = if f57(match v0.clone() {
        Adt5::C0(_, _, h82) => {
            h82
        }
    }) {
        f58(v5.clone(), v1.clone())
    } else {
        false
    };
    let v10: Bytes = if v9 {
        let a84 = f9(List::cons(Str::lit("establish"), List::cons(v5.clone(), List::<Str>::nil())));
        let a85 = f59(v5.clone(), match v4 {
            Adt6::C0(_, _, _, _, h83, _) => {
                h83
            }
        }, v2)?;
        append_bytes(a84, a85)
    } else {
        Bytes::lit(&[])
    };
    let v11: Bytes = if f58(v5.clone(), v1) {
        f9(List::cons(Str::lit("status"), List::cons(v5, List::cons(f60(match v0.clone() {
            Adt5::C0(_, _, h86) => {
                h86
            }
        }, match v0 {
            Adt5::C0(_, h87, _) => {
                h87
            }
        }, v3), List::<Str>::nil()))))
    } else {
        Bytes::lit(&[])
    };
    let a92 = {
        let a90 = {
            let a88 = v7;
            let a89 = v8;
            append_bytes(a88, a89)
        };
        let a91 = v10;
        append_bytes(a90, a91)
    };
    let a93 = v11;
    Ok(append_bytes(a92, a93))
}

pub fn f29(v0: List<Bytes>) -> Bytes {
    let a94 = f61(v0, Bytes::lit(&[0x20]));
    let a95 = Bytes::lit(&[0x0a]);
    append_bytes(a94, a95)
}

pub fn f30(v0: Fn6, p99: List<Bytes>, p100: List<Str>) -> List<Bytes> {
    let m98 = (p99, p100);
    {
        let mut m98 = m98;
        loop {
            let step = {
                let (v1, v2) = m98;
                let m96 = v2;
                match m96.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<Str>), List<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<Str>), List<Bytes>>(({
                            let c97: Fn6 = v0.clone();
                            c97.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m98 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f31(v0: List<Bytes>, v1: Str) -> List<Bytes> {
    let a101 = v0;
    let a102 = List::cons(f55(v1), List::<Bytes>::nil());
    append_list(a101, a102)
}

pub fn f32(v0: Fn7, p106: Str, p107: List<Adt5>) -> Str {
    let m105 = (p106, p107);
    {
        let mut m105 = m105;
        loop {
            let step = {
                let (v1, v2) = m105;
                let m103 = v2;
                match m103.uncons() {
                    None => {
                        Err::<(Str, List<Adt5>), Str>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Str, List<Adt5>), Str>(({
                            let c104: Fn7 = v0.clone();
                            c104.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m105 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f33(v0: List<(Str, bool)>, v1: List<Str>, v2: Str, v3: Adt5) -> Str {
    if f58({
        let m110 = match v3.clone() {
            Adt5::C0(h109, _, _) => {
                h109
            }
        };
        match m110 {
            Adt6::C0(h108, _, _, _, _, _) => {
                h108
            }
        }
    }, v1) {
        let v4: Str = f60(match v3.clone() {
            Adt5::C0(_, _, h111) => {
                h111
            }
        }, match v3 {
            Adt5::C0(_, h112, _) => {
                h112
            }
        }, v0);
        let a113 = v2.clone();
        let a114 = Str::lit("failure");
        if equal(a113, a114) {
            v2
        } else {
            let a115 = v4.clone();
            let a116 = Str::lit("failure");
            if equal(a115, a116) {
                v4
            } else {
                let a117 = v2.clone();
                let a118 = Str::lit("success");
                if equal(a117, a118) {
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
    let v2: (Bytes, Bytes) = f62(v1)?;
    let v3: Bytes = {
        let (h119, _) = v2.clone();
        h119
    };
    let v4: (Bytes, Bytes) = f62({
        let (_, h120) = v2.clone();
        h120
    })?;
    let a121 = v3.clone();
    let a122 = f55(Str::lit("tree"));
    if equal(a121, a122) {
        Ok(Adt0::C0(List::cons(({
            let (h123, _) = v4;
            h123
        }, {
            let (_, h124) = v4;
            h124
        }), match v0.clone() {
            Adt0::C0(h125, _, _, _, _) => {
                h125
            }
        }), match v0.clone() {
            Adt0::C0(_, h126, _, _, _) => {
                h126
            }
        }, match v0.clone() {
            Adt0::C0(_, _, h127, _, _) => {
                h127
            }
        }, match v0.clone() {
            Adt0::C0(_, _, _, h128, _) => {
                h128
            }
        }, match v0 {
            Adt0::C0(_, _, _, _, h129) => {
                h129
            }
        }))
    } else {
        let a130 = v3.clone();
        let a131 = f55(Str::lit("signed"));
        if equal(a130, a131) {
            Ok(Adt0::C0(match v0.clone() {
                Adt0::C0(h132, _, _, _, _) => {
                    h132
                }
            }, {
                let v5: (Bytes, Bytes) = f62({
                    let (_, h133) = v4;
                    h133
                })?;
                let v6: (Bytes, Bytes) = f62({
                    let (_, h134) = v5;
                    h134
                })?;
                let v7: (Bytes, Bytes) = f62({
                    let (_, h135) = v6;
                    h135
                })?;
                let v8: (Bytes, Bytes) = f62({
                    let (_, h136) = v7;
                    h136
                })?;
                List::cons(Adt1::C0(f63({
                    let (h137, _) = v4;
                    h137
                }), f63({
                    let (h138, _) = v5;
                    h138
                }), f64({
                    let (h139, _) = v6;
                    h139
                }), f65({
                    let (h140, _) = v7;
                    h140
                }), f63({
                    let (_, h141) = v8;
                    h141
                }), f66({
                    let (h142, _) = v8;
                    h142
                })), match v0.clone() {
                    Adt0::C0(_, h143, _, _, _) => {
                        h143
                    }
                })
            }, match v0.clone() {
                Adt0::C0(_, _, h144, _, _) => {
                    h144
                }
            }, match v0.clone() {
                Adt0::C0(_, _, _, h145, _) => {
                    h145
                }
            }, match v0 {
                Adt0::C0(_, _, _, _, h146) => {
                    h146
                }
            }))
        } else {
            let a147 = v3.clone();
            let a148 = f55(Str::lit("trust-repository"));
            if equal(a147, a148) {
                Ok(Adt0::C0(match v0.clone() {
                    Adt0::C0(h149, _, _, _, _) => {
                        h149
                    }
                }, match v0.clone() {
                    Adt0::C0(_, h150, _, _, _) => {
                        h150
                    }
                }, f63({
                    let (_, h151) = v2;
                    h151
                }), match v0.clone() {
                    Adt0::C0(_, _, _, h152, _) => {
                        h152
                    }
                }, match v0 {
                    Adt0::C0(_, _, _, _, h153) => {
                        h153
                    }
                }))
            } else {
                let a154 = v3.clone();
                let a155 = f55(Str::lit("trust-maintainer"));
                if equal(a154, a155) {
                    Ok(Adt0::C0(match v0.clone() {
                        Adt0::C0(h156, _, _, _, _) => {
                            h156
                        }
                    }, match v0.clone() {
                        Adt0::C0(_, h157, _, _, _) => {
                            h157
                        }
                    }, match v0.clone() {
                        Adt0::C0(_, _, h158, _, _) => {
                            h158
                        }
                    }, List::cons(f63({
                        let (_, h159) = v2;
                        h159
                    }), match v0.clone() {
                        Adt0::C0(_, _, _, h160, _) => {
                            h160
                        }
                    }), match v0 {
                        Adt0::C0(_, _, _, _, h161) => {
                            h161
                        }
                    }))
                } else {
                    let a162 = v3;
                    let a163 = f55(Str::lit("event"));
                    if equal(a162, a163) {
                        Ok(Adt0::C0(match v0.clone() {
                            Adt0::C0(h164, _, _, _, _) => {
                                h164
                            }
                        }, match v0.clone() {
                            Adt0::C0(_, h165, _, _, _) => {
                                h165
                            }
                        }, match v0.clone() {
                            Adt0::C0(_, _, h166, _, _) => {
                                h166
                            }
                        }, match v0 {
                            Adt0::C0(_, _, _, h167, _) => {
                                h167
                            }
                        }, f67({
                            let (_, h168) = v2;
                            h168
                        })))
                    } else {
                        Ok(v0)
                    }
                }
            }
        }
    }
}

pub fn f35(v0: Fn8, p173: u64, p174: (u64, (u64, List<Bytes>))) -> R<((u64, (u64, List<Bytes>)), bool)> {
    let m172 = (p173, p174);
    {
        let mut m172 = m172;
        loop {
            let step = {
                let (v1, v2) = m172;
                let m169 = v1;
                if m169 == 0 {
                    Err::<(u64, (u64, (u64, List<Bytes>))), R<((u64, (u64, List<Bytes>)), bool)>>(Ok((v2, false)))
                } else {
                    let v3 = m169 - 1;
                    let m171 = {
                        let c170: Fn8 = v0.clone();
                        c170.apply(v2.clone())?
                    };
                    match m171 {
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
                Ok(next) => { m172 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f36(v0: Bytes, v1: (u64, (u64, List<Bytes>))) -> R<Option<(u64, (u64, List<Bytes>))>> {
    f68(v0, v1)
}

pub fn f37(v0: Bytes, v1: u64, v2: u64) -> Bytes {
    let m178 = {
        let a175 = v0;
        let a176 = v1;
        let a177 = v2;
        slice_bytes(a175, a176, a177)
    };
    match m178 {
        None => {
            Bytes::lit(&[])
        }
        Some(v3) => {
            v3
        }
    }
}

pub fn f38(v0: Fn9, p182: List<(Bytes, Bytes)>, p183: List<(Bytes, Bytes)>) -> List<(Bytes, Bytes)> {
    let m181 = (p182, p183);
    {
        let mut m181 = m181;
        loop {
            let step = {
                let (v1, v2) = m181;
                let m179 = v2;
                match m179.uncons() {
                    None => {
                        Err::<(List<(Bytes, Bytes)>, List<(Bytes, Bytes)>), List<(Bytes, Bytes)>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<(Bytes, Bytes)>, List<(Bytes, Bytes)>), List<(Bytes, Bytes)>>(({
                            let c180: Fn9 = v0.clone();
                            c180.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m181 = next; }
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

pub fn f42() -> List<Adt6> {
    f72(f73())
}

pub fn f43(v0: List<Adt6>) -> List<Str> {
    f70(Fn12::F74, List::<Str>::nil(), v0)
}

pub fn f44() -> List<Adt6> {
    f72(f75())
}

pub fn f45(v0: Adt1, v1: Adt9) -> bool {
    let m185 = match v0.clone() {
        Adt1::C0(_, _, _, h184, _, _) => {
            h184
        }
    };
    match m185 {
        Adt2::C0 => {
            let a188 = match v0 {
                Adt1::C0(_, _, _, _, h186, _) => {
                    h186
                }
            };
            let a189 = match v1 {
                Adt9::C0(h187, _) => {
                    h187
                }
            };
            equal(a188, a189)
        }
        Adt2::C1 => {
            f58(match v0 {
                Adt1::C0(_, _, _, _, h190, _) => {
                    h190
                }
            }, match v1 {
                Adt9::C0(_, h191) => {
                    h191
                }
            })
        }
        Adt2::C2 => {
            false
        }
    }
}

pub fn f46(v0: List<(Bytes, Bytes)>, v1: List<(Str, bool)>, v2: (List<Adt5>, List<(List<Str>, Str)>), v3: Adt6) -> R<(List<Adt5>, List<(List<Str>, Str)>)> {
    let v4: List<Adt5> = {
        let (h192, _) = v2;
        h192
    };
    let v5: List<(List<Str>, Str)> = {
        let (_, h193) = v2;
        h193
    };
    let v6: List<Str> = match v3.clone() {
        Adt6::C0(_, _, _, _, h194, _) => {
            h194
        }
    };
    let v8: Str = {
        let m195 = f76(v6.clone(), v5.clone());
        match m195 {
            None => {
                f77(v6.clone(), v0)?
            }
            Some(v7) => {
                v7
            }
        }
    };
    let v9: List<Adt5> = f78(match v3.clone() {
        Adt6::C0(_, _, _, _, _, h196) => {
            h196
        }
    }, v4.clone());
    let v10: Str = f79(v3.clone(), v8.clone(), v9.clone())?;
    let v11: List<Adt8> = if f80(match v3.clone() {
        Adt6::C0(_, _, _, _, _, h197) => {
            h197
        }
    }, v4.clone()) {
        f81(v9)
    } else {
        List::cons(Adt8::C3, List::<Adt8>::nil())
    };
    Ok(({
        let a199 = v4;
        let a200 = List::cons(Adt5::C0(v3.clone(), v10.clone(), f82(match v3 {
            Adt6::C0(_, h198, _, _, _, _) => {
                h198
            }
        }, v10, v1, v11)), List::<Adt5>::nil());
        append_list(a199, a200)
    }, List::cons((v6, v8), v5)))
}

pub fn f47(v0: Adt6) -> Adt6 {
    Adt6::C0(match v0.clone() {
        Adt6::C0(h201, _, _, _, _, _) => {
            h201
        }
    }, match v0.clone() {
        Adt6::C0(_, h202, _, _, _, _) => {
            h202
        }
    }, f63(f56(match v0.clone() {
        Adt6::C0(h203, _, _, _, _, _) => {
            h203
        }
    })), match v0.clone() {
        Adt6::C0(_, _, _, h204, _, _) => {
            h204
        }
    }, match v0.clone() {
        Adt6::C0(_, _, _, _, h205, _) => {
            h205
        }
    }, match v0 {
        Adt6::C0(_, _, _, _, _, h206) => {
            h206
        }
    })
}

pub fn f48(v0: Fn10, p211: u64, p212: List<Bytes>) -> (List<Bytes>, bool) {
    let m210 = (p211, p212);
    {
        let mut m210 = m210;
        loop {
            let step = {
                let (v1, v2) = m210;
                let m207 = v1;
                if m207 == 0 {
                    Err::<(u64, List<Bytes>), (List<Bytes>, bool)>((v2, false))
                } else {
                    let v3 = m207 - 1;
                    let m209 = {
                        let c208: Fn10 = v0.clone();
                        c208.apply(v2.clone())
                    };
                    match m209 {
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
                Ok(next) => { m210 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f49(v0: List<Bytes>) -> Option<List<Bytes>> {
    f83(v0)
}

pub fn f50(v0: Fn11, p216: List<Bytes>, p217: List<Bytes>) -> List<Bytes> {
    let m215 = (p216, p217);
    {
        let mut m215 = m215;
        loop {
            let step = {
                let (v1, v2) = m215;
                let m213 = v2;
                match m213.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<Bytes>), List<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<Bytes>), List<Bytes>>(({
                            let c214: Fn11 = v0.clone();
                            c214.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m215 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f51(v0: List<Bytes>, v1: Bytes) -> List<Bytes> {
    List::cons(v1, v0)
}

pub fn f52(v0: Str) -> Adt10 {
    f84(Fn13::F85(v0), f86(Str::lit("@sdk"), Adt11::C0), f87())
}

pub fn f53(v0: Adt8) -> Str {
    let m218 = v0;
    match m218 {
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
    let m219 = v0;
    match m219 {
        Adt11::C0 => {
            Str::lit("sealed")
        }
        Adt11::C1 => {
            Str::lit("pinned")
        }
        Adt11::C2 => {
            Str::lit("daemon")
        }
        Adt11::C3 => {
            Str::lit("live")
        }
    }
}

pub fn f55(v0: Str) -> Bytes {
    let a220 = v0;
    utf8_encode(a220)
}

pub fn f56(v0: Str) -> Bytes {
    let v1: Adt10 = f52(v0);
    f61(List::cons({
        let a221 = Str::lit("prism/1");
        utf8_encode(a221)
    }, List::cons({
        let a222 = f88(v1.clone());
        utf8_encode(a222)
    }, List::cons({
        let a224 = match v1.clone() {
            Adt10::C0(_, h223, _, _, _, _) => {
                h223
            }
        };
        utf8_encode(a224)
    }, List::cons({
        let a226 = match v1.clone() {
            Adt10::C0(_, _, h225, _, _, _) => {
                h225
            }
        };
        utf8_encode(a226)
    }, List::cons({
        let a228 = match v1.clone() {
            Adt10::C0(_, _, _, h227, _, _) => {
                h227
            }
        };
        utf8_encode(a228)
    }, List::cons({
        let a230 = match v1.clone() {
            Adt10::C0(_, _, _, _, h229, _) => {
                h229
            }
        };
        utf8_encode(a230)
    }, List::cons({
        let a232 = f54(match v1 {
            Adt10::C0(_, _, _, _, _, h231) => {
                h231
            }
        });
        utf8_encode(a232)
    }, List::<Bytes>::nil()))))))), Bytes::lit(&[0x20]))
}

pub fn f57(v0: Adt8) -> bool {
    let m233 = v0;
    match m233 {
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
    f89(Fn14::F90(v0), false, v1)
}

pub fn f59(v0: Str, v1: List<Str>, v2: List<(Bytes, Bytes)>) -> R<Bytes> {
    Ok(f6(f91(Fn15::F92(v1, v0), List::<Bytes>::nil(), v2)?))
}

pub fn f60(v0: Adt8, v1: Str, v2: List<(Str, bool)>) -> Str {
    if f93(v0.clone()) {
        Str::lit("success")
    } else {
        let a234 = f53(v0);
        let a235 = Str::lit("refuted");
        if if equal(a234, a235) {
            true
        } else {
            f94(v1, v2)
        } {
            Str::lit("failure")
        } else {
            Str::lit("pending")
        }
    }
}

pub fn f61(v0: List<Bytes>, v1: Bytes) -> Bytes {
    let m236 = f95(Fn16::F96(v1), None::<Bytes>, v0);
    match m236 {
        None => {
            Bytes::lit(&[])
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f62(v0: Bytes) -> R<(Bytes, Bytes)> {
    let m237 = f97(v0.clone(), Bytes::lit(&[0x20]))?;
    match m237 {
        None => {
            Ok((v0, Bytes::lit(&[])))
        }
        Some(v1) => {
            Ok((f37(v0.clone(), 0u64, v1), f37(v0.clone(), {
                let a238 = v1;
                let a239 = 1u64;
                nat_add(a238, a239)?
            }, {
                let a243 = {
                    let a240 = v0;
                    length_bytes(a240)
                };
                let a244 = {
                    let a241 = v1;
                    let a242 = 1u64;
                    nat_add(a241, a242)?
                };
                nat_sub(a243, a244)
            })))
        }
    }
}

pub fn f63(v0: Bytes) -> Str {
    let m246 = {
        let a245 = v0;
        utf8_decode(a245)
    };
    match m246 {
        None => {
            Str::lit("")
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f64(v0: Bytes) -> bool {
    let a247 = v0;
    let a248 = f55(Str::lit("pass"));
    equal(a247, a248)
}

pub fn f65(v0: Bytes) -> Adt2 {
    let a249 = v0.clone();
    let a250 = f55(Str::lit("workflow"));
    if equal(a249, a250) {
        Adt2::C0
    } else {
        let a251 = v0;
        let a252 = f55(Str::lit("maintainer"));
        if equal(a251, a252) {
            Adt2::C1
        } else {
            Adt2::C2
        }
    }
}

pub fn f66(v0: Bytes) -> Adt3 {
    let a253 = v0.clone();
    let a254 = f55(Str::lit("workstation"));
    if equal(a253, a254) {
        Adt3::C1
    } else {
        let a255 = v0;
        let a256 = f55(Str::lit("browser"));
        if equal(a255, a256) {
            Adt3::C2
        } else {
            Adt3::C0
        }
    }
}

pub fn f67(v0: Bytes) -> Adt4 {
    let a257 = v0.clone();
    let a258 = f55(Str::lit("pull_request"));
    if equal(a257, a258) {
        Adt4::C0
    } else {
        let a259 = v0.clone();
        let a260 = f55(Str::lit("push"));
        if equal(a259, a260) {
            Adt4::C1
        } else {
            let a261 = v0;
            let a262 = f55(Str::lit("tag"));
            if equal(a261, a262) {
                Adt4::C2
            } else {
                Adt4::C3
            }
        }
    }
}

pub fn f68(v0: Bytes, v1: (u64, (u64, List<Bytes>))) -> R<Option<(u64, (u64, List<Bytes>))>> {
    let v2: u64 = {
        let (h263, _) = v1.clone();
        h263
    };
    let v3: u64 = {
        let (h264, _) = {
            let (_, h265) = v1.clone();
            h265
        };
        h264
    };
    let v4: List<Bytes> = {
        let (_, h266) = {
            let (_, h267) = v1;
            h267
        };
        h266
    };
    let m268 = f98(v0.clone(), v2);
    match m268 {
        None => {
            Ok(None::<(u64, (u64, List<Bytes>))>)
        }
        Some(v5) => {
            let a269 = v5;
            let a270 = 10u8;
            if equal(a269, a270) {
                Ok(Some(({
                    let a271 = v2;
                    let a272 = 1u64;
                    nat_add(a271, a272)?
                }, ({
                    let a273 = v2;
                    let a274 = 1u64;
                    nat_add(a273, a274)?
                }, List::cons(f99(f37(v0, v3, {
                    let a275 = v2;
                    let a276 = v3;
                    nat_sub(a275, a276)
                })), v4)))))
            } else {
                Ok(Some(({
                    let a277 = v2;
                    let a278 = 1u64;
                    nat_add(a277, a278)?
                }, (v3, v4))))
            }
        }
    }
}

pub fn f69() -> List<Str> {
    List::cons(Str::lit("factory-model"), List::cons(Str::lit("lint"), List::cons(Str::lit("model-audits"), List::cons(Str::lit("fixtures-golden"), List::<Str>::nil()))))
}

pub fn f70(v0: Fn12, p282: List<Str>, p283: List<Adt6>) -> List<Str> {
    let m281 = (p282, p283);
    {
        let mut m281 = m281;
        loop {
            let step = {
                let (v1, v2) = m281;
                let m279 = v2;
                match m279.uncons() {
                    None => {
                        Err::<(List<Str>, List<Adt6>), List<Str>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Str>, List<Adt6>), List<Str>>(({
                            let c280: Fn12 = v0.clone();
                            c280.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m281 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f71(v0: List<Str>, v1: Adt6) -> List<Str> {
    if f100(v1.clone()) {
        let a285 = v0;
        let a286 = List::cons(match v1 {
            Adt6::C0(h284, _, _, _, _, _) => {
                h284
            }
        }, List::<Str>::nil());
        append_list(a285, a286)
    } else {
        v0
    }
}

pub fn f72(v0: List<Adt6>) -> List<Adt6> {
    f23(Fn5::F101, List::<Adt6>::nil(), v0)
}

pub fn f73() -> List<Adt6> {
    List::cons(f102(Str::lit("policy"), Adt7::C0, Str::lit("actions"), Str::lit("release.yml/policy"), List::cons(Str::lit(".github/workflows/release.yml"), List::cons(Str::lit("Cargo.toml"), List::cons(Str::lit("model/errors.toml"), List::cons(Str::lit("scripts/"), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil())))))), List::<Str>::nil()), List::cons(f102(Str::lit("factory-model"), Adt7::C0, Str::lit("host"), Str::lit("bash prism-factory/check.sh"), List::cons(Str::lit(".github/workflows/factory.yml"), List::cons(Str::lit(".github/workflows/prism-delegation.yml"), List::cons(Str::lit(".github/workflows/release-cut.yml"), List::cons(Str::lit(".github/workflows/release.yml"), List::cons(Str::lit("prism-factory/"), List::cons(Str::lit("vendor/lexlean/"), List::<Str>::nil())))))), List::<Str>::nil()), List::cons(f102(Str::lit("plumbing"), Adt7::C0, Str::lit("actions"), Str::lit("release.yml/devcontainer-image"), List::cons(Str::lit(""), List::cons(Str::lit("@run"), List::<Str>::nil())), List::cons(Str::lit("policy"), List::<Str>::nil())), List::cons(f102(Str::lit("vv-sdk"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/vv-sdk"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.mjs"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/release-rebuild.sh"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-candidate-sbom.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/vv-sdk.yml"), List::<Str>::nil())))))))))))))))))))))))))))))))), List::<Str>::nil()), List::cons(f102(Str::lit("source-vv"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/source-vv"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.mjs"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/release-rebuild.sh"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-candidate-sbom.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/source-vv.yml"), List::<Str>::nil())))))))))))))))))))))))))))))))), List::cons(Str::lit("vv-sdk"), List::<Str>::nil())), List::cons(f102(Str::lit("build"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/build"), List::cons(Str::lit(""), List::cons(Str::lit("!.github/workflows/release-cut.yml"), List::cons(Str::lit("!.github/workflows/release-qualify.yml"), List::cons(Str::lit("!.github/workflows/release.yml"), List::cons(Str::lit("!factory/"), List::cons(Str::lit("!scripts/browser-api-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/ci-capacity.test.mjs"), List::cons(Str::lit("!scripts/factory.mjs"), List::cons(Str::lit("!scripts/factory.test.mjs"), List::cons(Str::lit("!scripts/lexlean-pin.test.mjs"), List::cons(Str::lit("!scripts/library-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/product-sdk-check.test.mjs"), List::cons(Str::lit("!scripts/release-gate-evidence.test.mjs"), List::cons(Str::lit("!scripts/release-native-contract.test.mjs"), List::cons(Str::lit("!scripts/release-phases.md"), List::cons(Str::lit("!scripts/release-phases.test.mjs"), List::cons(Str::lit("!scripts/release-publication.mjs"), List::cons(Str::lit("!scripts/release-publication.test.mjs"), List::cons(Str::lit("!scripts/rust-oracle-tools-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-candidate-sbom.test.mjs"), List::cons(Str::lit("!scripts/sdk-construction-handoff.test.mjs"), List::cons(Str::lit("!scripts/sdk-image-inputs.test.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.mjs"), List::cons(Str::lit("!scripts/sdk-release-evidence.test.mjs"), List::cons(Str::lit("!scripts/sdk-vv-check.test.mjs"), List::cons(Str::lit("!scripts/unpublished-sdk-qualification.test.mjs"), List::cons(Str::lit("!prism-factory/"), List::cons(Str::lit("scripts/release-gate-evidence.mjs"), List::cons(Str::lit("scripts/release-phases.mjs"), List::cons(Str::lit("scripts/release-rebuild.sh"), List::cons(Str::lit("prism-factory/jobs/header.yml"), List::cons(Str::lit("prism-factory/jobs/image-platforms.yml"), List::cons(Str::lit("prism-factory/jobs/images.yml"), List::cons(Str::lit("prism-factory/jobs/reproducibility.yml"), List::cons(Str::lit("prism-factory/jobs/native.yml"), List::cons(Str::lit("prism-factory/jobs/installed-sdk.yml"), List::<Str>::nil())))))))))))))))))))))))))))))))))))), List::<Str>::nil()), List::cons(f102(Str::lit("gate"), Adt7::C0, Str::lit("actions"), Str::lit("release.yml/gate"), List::cons(Str::lit(""), List::cons(Str::lit("@run"), List::<Str>::nil())), List::cons(Str::lit("plumbing"), List::cons(Str::lit("source-vv"), List::<Str>::nil()))), List::cons(f102(Str::lit("oci-native"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/oci-native"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("gate"), List::cons(Str::lit("build"), List::<Str>::nil()))), List::cons(f102(Str::lit("crates"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/crates"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("oci-native"), List::<Str>::nil())), List::cons(f102(Str::lit("release"), Adt7::C1, Str::lit("actions"), Str::lit("release.yml/release"), List::cons(Str::lit(""), List::cons(Str::lit("@mode"), List::cons(Str::lit("@run"), List::<Str>::nil()))), List::cons(Str::lit("factory-model"), List::cons(Str::lit("crates"), List::<Str>::nil()))), List::<Adt6>::nil()))))))))))
}

pub fn f74(v0: List<Str>, v1: Adt6) -> List<Str> {
    let a288 = v0;
    let a289 = List::cons(match v1 {
        Adt6::C0(h287, _, _, _, _, _) => {
            h287
        }
    }, List::<Str>::nil());
    append_list(a288, a289)
}

pub fn f75() -> List<Adt6> {
    List::cons(f102(Str::lit("lint"), Adt7::C1, Str::lit("prism"), Str::lit("cargo fetch --locked && cargo fmt --check && cargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings && cargo deny fetch && cargo deny --frozen --all-features check"), List::cons(Str::lit(""), List::<Str>::nil()), List::<Str>::nil()), List::cons(f102(Str::lit("model-audits"), Adt7::C1, Str::lit("prism"), Str::lit("bash scripts/fetch.sh && cargo xtask validate"), List::cons(Str::lit(""), List::<Str>::nil()), List::<Str>::nil()), List::cons(f102(Str::lit("fixtures-golden"), Adt7::C1, Str::lit("prism"), Str::lit("cargo fetch --locked && bash scripts/fetch-oracle-cargo.sh && cargo xtask check-fixtures && cargo run --locked --offline --manifest-path tests/holo-codec-oracle/Cargo.toml --target-dir target/holo-codec-oracle && cargo xtask check-golden"), List::cons(Str::lit(""), List::<Str>::nil()), List::<Str>::nil()), List::<Adt6>::nil())))
}

pub fn f76(v0: List<Str>, v1: List<(List<Str>, Str)>) -> Option<Str> {
    f103(Fn17::F104(v0), None::<Str>, v1)
}

pub fn f77(v0: List<Str>, v1: List<(Bytes, Bytes)>) -> R<Str> {
    Ok(f63(f105(f106(v0, v1)?)?))
}

pub fn f78(v0: List<Str>, v1: List<Adt5>) -> List<Adt5> {
    f107(Fn18::F108(v1), List::<Adt5>::nil(), v0)
}

pub fn f79(v0: Adt6, v1: Str, v2: List<Adt5>) -> R<Str> {
    Ok(f63(f105(f109(v0, v1, v2)?)?))
}

pub fn f80(v0: List<Str>, v1: List<Adt5>) -> bool {
    f89(Fn14::F110(v1), true, v0)
}

pub fn f81(v0: List<Adt5>) -> List<Adt8> {
    f111(Fn19::F112, List::<Adt8>::nil(), v0)
}

pub fn f82(v0: Adt7, v1: Str, v2: List<(Str, bool)>, v3: List<Adt8>) -> Adt8 {
    if f113(v3) {
        let m290 = f114(v1, v2);
        match m290 {
            None => {
                Adt8::C1
            }
            Some(v4) => {
                if v4 {
                    Adt8::C0
                } else {
                    let m291 = v0;
                    match m291 {
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

pub fn f83(v0: List<Bytes>) -> Option<List<Bytes>> {
    let m292 = v0.clone();
    match m292.uncons() {
        None => {
            None::<List<Bytes>>
        }
        Some((_, v2)) => {
            let m293 = v2;
            match m293.uncons() {
                None => {
                    None::<List<Bytes>>
                }
                Some((_, _)) => {
                    let v5: (Option<Bytes>, List<Bytes>) = f115(Fn20::F116, (None::<Bytes>, List::<Bytes>::nil()), v0);
                    let m295 = {
                        let (h294, _) = v5;
                        h294
                    };
                    match m295 {
                        None => {
                            Some(f27({
                                let (_, h297) = v5;
                                h297
                            }))
                        }
                        Some(v6) => {
                            Some(f27(List::cons(v6, {
                                let (_, h296) = v5;
                                h296
                            })))
                        }
                    }
                }
            }
        }
    }
}

pub fn f84(v0: Fn13, p301: Adt10, p302: List<(Str, Adt10)>) -> Adt10 {
    let m300 = (p301, p302);
    {
        let mut m300 = m300;
        loop {
            let step = {
                let (v1, v2) = m300;
                let m298 = v2;
                match m298.uncons() {
                    None => {
                        Err::<(Adt10, List<(Str, Adt10)>), Adt10>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Adt10, List<(Str, Adt10)>), Adt10>(({
                            let c299: Fn13 = v0.clone();
                            c299.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m300 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f85(v0: Str, v1: Adt10, v2: (Str, Adt10)) -> Adt10 {
    let a304 = {
        let (h303, _) = v2;
        h303
    };
    let a305 = v0;
    if equal(a304, a305) {
        let (_, h306) = v2;
        h306
    } else {
        v1
    }
}

pub fn f86(v0: Str, v1: Adt11) -> Adt10 {
    Adt10::C0(v0, Str::lit("1000:1000"), Str::lit("0022"), Str::lit("tmp/prismpm-home"), Str::lit("tmp"), v1)
}

pub fn f87() -> List<(Str, Adt10)> {
    List::cons((Str::lit("policy"), f86(Str::lit("@sdk"), Adt11::C0)), List::cons((Str::lit("factory-model"), f86(Str::lit("@sdk"), Adt11::C1)), List::cons((Str::lit("plumbing"), f86(Str::lit("@sdk"), Adt11::C1)), List::cons((Str::lit("vv-sdk"), f86(Str::lit("@sdk"), Adt11::C1)), List::cons((Str::lit("source-vv"), f86(Str::lit("@vv-sdk"), Adt11::C0)), List::cons((Str::lit("build"), f86(Str::lit("@sdk"), Adt11::C1)), List::cons((Str::lit("gate"), f86(Str::lit("@vv-sdk"), Adt11::C0)), List::cons((Str::lit("oci-native"), f86(Str::lit("@build"), Adt11::C1)), List::cons((Str::lit("crates"), f86(Str::lit("@build"), Adt11::C1)), List::cons((Str::lit("release"), f86(Str::lit("@build"), Adt11::C1)), List::cons((Str::lit("lint"), f86(Str::lit("@sdk"), Adt11::C1)), List::cons((Str::lit("model-audits"), f86(Str::lit("@sdk"), Adt11::C2)), List::cons((Str::lit("fixtures-golden"), f86(Str::lit("@sdk"), Adt11::C1)), List::<(Str, Adt10)>::nil())))))))))))))
}

pub fn f88(v0: Adt10) -> Str {
    let a308 = match v0.clone() {
        Adt10::C0(h307, _, _, _, _, _) => {
            h307
        }
    };
    let a309 = Str::lit("@sdk");
    if equal(a308, a309) {
        f10()
    } else {
        match v0 {
            Adt10::C0(h310, _, _, _, _, _) => {
                h310
            }
        }
    }
}

pub fn f89(v0: Fn14, p314: bool, p315: List<Str>) -> bool {
    let m313 = (p314, p315);
    {
        let mut m313 = m313;
        loop {
            let step = {
                let (v1, v2) = m313;
                let m311 = v2;
                match m311.uncons() {
                    None => {
                        Err::<(bool, List<Str>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<Str>), bool>(({
                            let c312: Fn14 = v0.clone();
                            c312.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m313 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f90(v0: Str, v1: bool, v2: Str) -> bool {
    if v1 {
        true
    } else {
        let a316 = v2;
        let a317 = v0;
        equal(a316, a317)
    }
}

pub fn f91(v0: Fn15, p321: List<Bytes>, p322: List<(Bytes, Bytes)>) -> R<List<Bytes>> {
    let m320 = (p321, p322);
    {
        let mut m320 = m320;
        loop {
            let step = {
                let (v1, v2) = m320;
                let m318 = v2;
                match m318.uncons() {
                    None => {
                        Err::<(List<Bytes>, List<(Bytes, Bytes)>), R<List<Bytes>>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Bytes>, List<(Bytes, Bytes)>), R<List<Bytes>>>(({
                            let c319: Fn15 = v0.clone();
                            c319.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m320 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f92(v0: List<Str>, v1: Str, v2: List<Bytes>, v3: (Bytes, Bytes)) -> R<List<Bytes>> {
    if f117(v0, {
        let (_, h323) = v3.clone();
        h323
    })? {
        Ok(List::cons(f29(List::cons(f55(Str::lit("file")), List::cons(f55(v1), List::cons({
            let (_, h324) = v3;
            h324
        }, List::<Bytes>::nil())))), v2))
    } else {
        Ok(v2)
    }
}

pub fn f93(v0: Adt8) -> bool {
    let m325 = v0;
    match m325 {
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

pub fn f94(v0: Str, v1: List<(Str, bool)>) -> bool {
    f118(Fn21::F119(v0), false, v1)
}

pub fn f95(v0: Fn16, p329: Option<Bytes>, p330: List<Bytes>) -> Option<Bytes> {
    let m328 = (p329, p330);
    {
        let mut m328 = m328;
        loop {
            let step = {
                let (v1, v2) = m328;
                let m326 = v2;
                match m326.uncons() {
                    None => {
                        Err::<(Option<Bytes>, List<Bytes>), Option<Bytes>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Bytes>, List<Bytes>), Option<Bytes>>(({
                            let c327: Fn16 = v0.clone();
                            c327.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m328 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f96(v0: Bytes, v1: Option<Bytes>, v2: Bytes) -> Option<Bytes> {
    let m331 = v1;
    match m331 {
        None => {
            Some(v2)
        }
        Some(v3) => {
            Some({
                let a334 = {
                    let a332 = v3;
                    let a333 = v0;
                    append_bytes(a332, a333)
                };
                let a335 = v2;
                append_bytes(a334, a335)
            })
        }
    }
}

pub fn f97(v0: Bytes, v1: Bytes) -> R<Option<u64>> {
    let v2: u64 = {
        let a336 = v0.clone();
        length_bytes(a336)
    };
    let v3: u64 = {
        let a337 = v1.clone();
        length_bytes(a337)
    };
    let v4: u64 = {
        let (h338, _) = f120(Fn22::F121(v1.clone(), v3, v0.clone(), v2), {
            let a339 = v2;
            let a340 = 1u64;
            nat_add(a339, a340)?
        }, 0u64)?;
        h338
    };
    if f122(v0, v1, v4) {
        Ok(Some(v4))
    } else {
        Ok(None::<u64>)
    }
}

pub fn f98(v0: Bytes, v1: u64) -> Option<u8> {
    let a341 = v0;
    let a342 = v1;
    index_bytes(a341, a342)
}

pub fn f99(v0: Bytes) -> Bytes {
    if f123(v0.clone(), Bytes::lit(&[0x0d])) {
        f37(v0.clone(), 0u64, {
            let a344 = {
                let a343 = v0;
                length_bytes(a343)
            };
            let a345 = 1u64;
            nat_sub(a344, a345)
        })
    } else {
        v0
    }
}

pub fn f100(v0: Adt6) -> bool {
    let a347 = f58(Str::lit("@mode"), match v0.clone() {
        Adt6::C0(_, _, _, _, h346, _) => {
            h346
        }
    });
    if bool_not(a347) {
        let a349 = f58(Str::lit("@run"), match v0 {
            Adt6::C0(_, _, _, _, h348, _) => {
                h348
            }
        });
        bool_not(a349)
    } else {
        false
    }
}

pub fn f101(v0: List<Adt6>, v1: Adt6) -> List<Adt6> {
    let a350 = v0;
    let a351 = List::cons(f124(v1), List::<Adt6>::nil());
    append_list(a350, a351)
}

pub fn f102(v0: Str, v1: Adt7, v2: Str, v3: Str, v4: List<Str>, v5: List<Str>) -> Adt6 {
    Adt6::C0(v0, v1, v2, v3, v4, v5)
}

pub fn f103(v0: Fn17, p355: Option<Str>, p356: List<(List<Str>, Str)>) -> Option<Str> {
    let m354 = (p355, p356);
    {
        let mut m354 = m354;
        loop {
            let step = {
                let (v1, v2) = m354;
                let m352 = v2;
                match m352.uncons() {
                    None => {
                        Err::<(Option<Str>, List<(List<Str>, Str)>), Option<Str>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Str>, List<(List<Str>, Str)>), Option<Str>>(({
                            let c353: Fn17 = v0.clone();
                            c353.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m354 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f104(v0: List<Str>, v1: Option<Str>, v2: (List<Str>, Str)) -> Option<Str> {
    if f125({
        let (h357, _) = v2;
        h357
    }, v0) {
        Some({
            let (_, h358) = v2;
            h358
        })
    } else {
        v1
    }
}

pub fn f105(v0: Bytes) -> R<Bytes> {
    Ok(f126(f127(v0)?))
}

pub fn f106(v0: List<Str>, v1: List<(Bytes, Bytes)>) -> R<Bytes> {
    Ok(f6(f91(Fn15::F128(v0), List::<Bytes>::nil(), v1)?))
}

pub fn f107(v0: Fn18, p362: List<Adt5>, p363: List<Str>) -> List<Adt5> {
    let m361 = (p362, p363);
    {
        let mut m361 = m361;
        loop {
            let step = {
                let (v1, v2) = m361;
                let m359 = v2;
                match m359.uncons() {
                    None => {
                        Err::<(List<Adt5>, List<Str>), List<Adt5>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt5>, List<Str>), List<Adt5>>(({
                            let c360: Fn18 = v0.clone();
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

pub fn f108(v0: List<Adt5>, v1: List<Adt5>, v2: Str) -> List<Adt5> {
    let m364 = f129(v2, v0);
    match m364 {
        None => {
            v1
        }
        Some(v3) => {
            let a365 = v1;
            let a366 = List::cons(v3, List::<Adt5>::nil());
            append_list(a365, a366)
        }
    }
}

pub fn f109(v0: Adt6, v1: Str, v2: List<Adt5>) -> R<Bytes> {
    Ok(f26(List::cons(f29(List::cons(f55(Str::lit("prism-factory/obligation/1")), List::<Bytes>::nil())), List::cons(f29(List::cons(f55(Str::lit("name")), List::cons(f55(match v0.clone() {
        Adt6::C0(h367, _, _, _, _, _) => {
            h367
        }
    }), List::<Bytes>::nil()))), List::cons(f29(List::cons(f55(Str::lit("kind")), List::cons(f55(f130(match v0.clone() {
        Adt6::C0(_, h368, _, _, _, _) => {
            h368
        }
    })), List::<Bytes>::nil()))), List::cons(f29(List::cons(f55(Str::lit("environment")), List::cons(f55(match v0.clone() {
        Adt6::C0(_, _, h369, _, _, _) => {
            h369
        }
    }), List::<Bytes>::nil()))), List::cons(f29(List::cons(f55(Str::lit("run")), List::cons(f55(match v0.clone() {
        Adt6::C0(_, _, _, h370, _, _) => {
            h370
        }
    }), List::<Bytes>::nil()))), List::cons(f131(Str::lit("input"), match v0 {
        Adt6::C0(_, _, _, _, h371, _) => {
            h371
        }
    }), List::cons(f132(v2)?, List::cons(f29(List::cons(f55(Str::lit("closure")), List::cons(f55(v1), List::<Bytes>::nil()))), List::<Bytes>::nil()))))))))))
}

pub fn f110(v0: List<Adt5>, v1: bool, v2: Str) -> bool {
    let m372 = f129(v2, v0);
    match m372 {
        None => {
            false
        }
        Some(_) => {
            v1
        }
    }
}

pub fn f111(v0: Fn19, p376: List<Adt8>, p377: List<Adt5>) -> List<Adt8> {
    let m375 = (p376, p377);
    {
        let mut m375 = m375;
        loop {
            let step = {
                let (v1, v2) = m375;
                let m373 = v2;
                match m373.uncons() {
                    None => {
                        Err::<(List<Adt8>, List<Adt5>), List<Adt8>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(List<Adt8>, List<Adt5>), List<Adt8>>(({
                            let c374: Fn19 = v0.clone();
                            c374.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m375 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f112(v0: List<Adt8>, v1: Adt5) -> List<Adt8> {
    let a379 = v0;
    let a380 = List::cons(match v1 {
        Adt5::C0(_, _, h378) => {
            h378
        }
    }, List::<Adt8>::nil());
    append_list(a379, a380)
}

pub fn f113(v0: List<Adt8>) -> bool {
    f133(Fn23::F134, true, v0)
}

pub fn f114(v0: Str, v1: List<(Str, bool)>) -> Option<bool> {
    f135(Fn24::F136(v0), None::<bool>, v1)
}

pub fn f115(v0: Fn20, p384: (Option<Bytes>, List<Bytes>), p385: List<Bytes>) -> (Option<Bytes>, List<Bytes>) {
    let m383 = (p384, p385);
    {
        let mut m383 = m383;
        loop {
            let step = {
                let (v1, v2) = m383;
                let m381 = v2;
                match m381.uncons() {
                    None => {
                        Err::<((Option<Bytes>, List<Bytes>), List<Bytes>), (Option<Bytes>, List<Bytes>)>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<((Option<Bytes>, List<Bytes>), List<Bytes>), (Option<Bytes>, List<Bytes>)>(({
                            let c382: Fn20 = v0.clone();
                            c382.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m383 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f116(v0: (Option<Bytes>, List<Bytes>), v1: Bytes) -> (Option<Bytes>, List<Bytes>) {
    f137(v0, v1)
}

pub fn f117(v0: List<Str>, v1: Bytes) -> R<bool> {
    let a386 = f138(v0.clone(), v1.clone(), true)?;
    let a387 = f138(v0, v1, false)?;
    Ok(nat_lt(a386, a387))
}

pub fn f118(v0: Fn21, p391: bool, p392: List<(Str, bool)>) -> bool {
    let m390 = (p391, p392);
    {
        let mut m390 = m390;
        loop {
            let step = {
                let (v1, v2) = m390;
                let m388 = v2;
                match m388.uncons() {
                    None => {
                        Err::<(bool, List<(Str, bool)>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<(Str, bool)>), bool>(({
                            let c389: Fn21 = v0.clone();
                            c389.apply(v1, v3)
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

pub fn f119(v0: Str, v1: bool, v2: (Str, bool)) -> bool {
    if v1 {
        true
    } else {
        let a394 = {
            let (h393, _) = v2;
            h393
        };
        let a395 = v0;
        if equal(a394, a395) {
            let a397 = {
                let (_, h396) = v2;
                h396
            };
            bool_not(a397)
        } else {
            false
        }
    }
}

pub fn f120(v0: Fn22, p402: u64, p403: u64) -> R<(u64, bool)> {
    let m401 = (p402, p403);
    {
        let mut m401 = m401;
        loop {
            let step = {
                let (v1, v2) = m401;
                let m398 = v1;
                if m398 == 0 {
                    Err::<(u64, u64), R<(u64, bool)>>(Ok((v2, false)))
                } else {
                    let v3 = m398 - 1;
                    let m400 = {
                        let c399: Fn22 = v0.clone();
                        c399.apply(v2)?
                    };
                    match m400 {
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
                Ok(next) => { m401 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f121(v0: Bytes, v1: u64, v2: Bytes, v3: u64, v4: u64) -> R<Option<u64>> {
    if f122(v2, v0, v4) {
        Ok(None::<u64>)
    } else {
        let a406 = {
            let a404 = v4;
            let a405 = v1;
            nat_add(a404, a405)?
        };
        let a407 = v3;
        if nat_lt(a406, a407) {
            Ok(Some({
                let a408 = v4;
                let a409 = 1u64;
                nat_add(a408, a409)?
            }))
        } else {
            Ok(None::<u64>)
        }
    }
}

pub fn f122(v0: Bytes, v1: Bytes, v2: u64) -> bool {
    let m414 = {
        let a411 = v0;
        let a412 = v2;
        let a413 = {
            let a410 = v1.clone();
            length_bytes(a410)
        };
        slice_bytes(a411, a412, a413)
    };
    match m414 {
        None => {
            false
        }
        Some(v3) => {
            let a415 = v3;
            let a416 = v1;
            equal(a415, a416)
        }
    }
}

pub fn f123(v0: Bytes, v1: Bytes) -> bool {
    let v2: u64 = {
        let a417 = v0.clone();
        length_bytes(a417)
    };
    let v3: u64 = {
        let a418 = v1.clone();
        length_bytes(a418)
    };
    let a419 = v3;
    let a420 = v2;
    if nat_le(a419, a420) {
        let m426 = {
            let a423 = v0;
            let a424 = {
                let a421 = v2;
                let a422 = v3;
                nat_sub(a421, a422)
            };
            let a425 = v3;
            slice_bytes(a423, a424, a425)
        };
        match m426 {
            None => {
                false
            }
            Some(v4) => {
                let a427 = v4;
                let a428 = v1;
                equal(a427, a428)
            }
        }
    } else {
        false
    }
}

pub fn f124(v0: Adt6) -> Adt6 {
    Adt6::C0(match v0.clone() {
        Adt6::C0(h429, _, _, _, _, _) => {
            h429
        }
    }, match v0.clone() {
        Adt6::C0(_, h430, _, _, _, _) => {
            h430
        }
    }, Str::lit("prism"), match v0.clone() {
        Adt6::C0(_, _, _, h431, _, _) => {
            h431
        }
    }, match v0.clone() {
        Adt6::C0(_, _, _, _, h432, _) => {
            h432
        }
    }, match v0 {
        Adt6::C0(_, _, _, _, _, h433) => {
            h433
        }
    })
}

pub fn f125(p440: List<Str>, p441: List<Str>) -> bool {
    let m439 = (p440, p441);
    {
        let mut m439 = m439;
        loop {
            let step = {
                let (v0, v1) = m439;
                let m434 = v0;
                match m434.uncons() {
                    None => {
                        let m435 = v1;
                        match m435.uncons() {
                            None => {
                                Err::<(List<Str>, List<Str>), bool>(true)
                            }
                            Some((_, _)) => {
                                Err::<(List<Str>, List<Str>), bool>(false)
                            }
                        }
                    }
                    Some((v4, v5)) => {
                        let m436 = v1;
                        match m436.uncons() {
                            None => {
                                Err::<(List<Str>, List<Str>), bool>(false)
                            }
                            Some((v6, v7)) => {
                                let a437 = v4;
                                let a438 = v6;
                                if equal(a437, a438) {
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
                Ok(next) => { m439 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f126(v0: Adt12) -> Bytes {
    let a462 = f139(match v0.clone() {
        Adt12::C0(h442, _, _, _, _, _, _, _) => {
            h442
        }
    });
    let a463 = {
        let a460 = f139(match v0.clone() {
            Adt12::C0(_, h443, _, _, _, _, _, _) => {
                h443
            }
        });
        let a461 = {
            let a458 = f139(match v0.clone() {
                Adt12::C0(_, _, h444, _, _, _, _, _) => {
                    h444
                }
            });
            let a459 = {
                let a456 = f139(match v0.clone() {
                    Adt12::C0(_, _, _, h445, _, _, _, _) => {
                        h445
                    }
                });
                let a457 = {
                    let a454 = f139(match v0.clone() {
                        Adt12::C0(_, _, _, _, h446, _, _, _) => {
                            h446
                        }
                    });
                    let a455 = {
                        let a452 = f139(match v0.clone() {
                            Adt12::C0(_, _, _, _, _, h447, _, _) => {
                                h447
                            }
                        });
                        let a453 = {
                            let a450 = f139(match v0.clone() {
                                Adt12::C0(_, _, _, _, _, _, h448, _) => {
                                    h448
                                }
                            });
                            let a451 = f139(match v0 {
                                Adt12::C0(_, _, _, _, _, _, _, h449) => {
                                    h449
                                }
                            });
                            append_bytes(a450, a451)
                        };
                        append_bytes(a452, a453)
                    };
                    append_bytes(a454, a455)
                };
                append_bytes(a456, a457)
            };
            append_bytes(a458, a459)
        };
        append_bytes(a460, a461)
    };
    append_bytes(a462, a463)
}

pub fn f127(v0: Bytes) -> R<Adt12> {
    let v1: u64 = {
        let a464 = v0.clone();
        length_bytes(a464)
    };
    let v2: u64 = {
        let a470 = {
            let a467 = {
                let a465 = v1;
                let a466 = 72u64;
                nat_add(a465, a466)?
            };
            let a468 = 64u64;
            let a469 = 0u64;
            nat_quot(a467, a468, a469)
        };
        let a471 = 64u64;
        nat_mul(a470, a471)?
    };
    let (_, h472) = f140(Fn25::F141(v0, v1, v2), {
        let a473 = v2;
        let a474 = 64u64;
        let a475 = 0u64;
        nat_quot(a473, a474, a475)
    }, (0u64, f142()))?;
    Ok(h472)
}

pub fn f128(v0: List<Str>, v1: List<Bytes>, v2: (Bytes, Bytes)) -> R<List<Bytes>> {
    if f117(v0, {
        let (_, h476) = v2.clone();
        h476
    })? {
        Ok(List::cons(f29(List::cons(f55(Str::lit("file")), List::cons({
            let (h477, _) = v2;
            h477
        }, List::cons({
            let (_, h478) = v2;
            h478
        }, List::<Bytes>::nil())))), v1))
    } else {
        Ok(v1)
    }
}

pub fn f129(v0: Str, v1: List<Adt5>) -> Option<Adt5> {
    f143(Fn26::F144(v0), None::<Adt5>, v1)
}

pub fn f130(v0: Adt7) -> Str {
    let m479 = v0;
    match m479 {
        Adt7::C0 => {
            Str::lit("hermetic")
        }
        Adt7::C1 => {
            Str::lit("fetch")
        }
    }
}

pub fn f131(v0: Str, v1: List<Str>) -> Bytes {
    f6(f30(Fn6::F145(v0), List::<Bytes>::nil(), v1))
}

pub fn f132(v0: List<Adt5>) -> R<Bytes> {
    Ok(f6(f7(Fn0::F146, List::<Bytes>::nil(), v0)?))
}

pub fn f133(v0: Fn23, p483: bool, p484: List<Adt8>) -> bool {
    let m482 = (p483, p484);
    {
        let mut m482 = m482;
        loop {
            let step = {
                let (v1, v2) = m482;
                let m480 = v2;
                match m480.uncons() {
                    None => {
                        Err::<(bool, List<Adt8>), bool>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(bool, List<Adt8>), bool>(({
                            let c481: Fn23 = v0.clone();
                            c481.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m482 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f134(v0: bool, v1: Adt8) -> bool {
    if v0 {
        f93(v1)
    } else {
        false
    }
}

pub fn f135(v0: Fn24, p488: Option<bool>, p489: List<(Str, bool)>) -> Option<bool> {
    let m487 = (p488, p489);
    {
        let mut m487 = m487;
        loop {
            let step = {
                let (v1, v2) = m487;
                let m485 = v2;
                match m485.uncons() {
                    None => {
                        Err::<(Option<bool>, List<(Str, bool)>), Option<bool>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<bool>, List<(Str, bool)>), Option<bool>>(({
                            let c486: Fn24 = v0.clone();
                            c486.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m487 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f136(v0: Str, v1: Option<bool>, v2: (Str, bool)) -> Option<bool> {
    let a491 = {
        let (h490, _) = v2;
        h490
    };
    let a492 = v0;
    if equal(a491, a492) {
        let m493 = v1;
        match m493 {
            None => {
                Some({
                    let (_, h495) = v2;
                    h495
                })
            }
            Some(v3) => {
                Some(if v3 {
                    true
                } else {
                    let (_, h494) = v2;
                    h494
                })
            }
        }
    } else {
        v1
    }
}

pub fn f137(v0: (Option<Bytes>, List<Bytes>), v1: Bytes) -> (Option<Bytes>, List<Bytes>) {
    let m497 = {
        let (h496, _) = v0;
        h496
    };
    match m497 {
        None => {
            (Some(v1), {
                let (_, h498) = v0;
                h498
            })
        }
        Some(v2) => {
            (None::<Bytes>, List::cons({
                let a499 = v2;
                let a500 = v1;
                append_bytes(a499, a500)
            }, {
                let (_, h501) = v0;
                h501
            }))
        }
    }
}

pub fn f138(v0: List<Str>, v1: Bytes, v2: bool) -> R<u64> {
    f147(Fn27::F148(v2, v1), 0u64, v0)
}

pub fn f139(v0: u32) -> Bytes {
    let a530 = f149({
        let a502 = f150(v0, 28u32);
        let a503 = 15u32;
        fixed_u32::bit_and(a502, a503)
    });
    let a531 = {
        let a528 = f149({
            let a504 = f150(v0, 24u32);
            let a505 = 15u32;
            fixed_u32::bit_and(a504, a505)
        });
        let a529 = {
            let a526 = f149({
                let a506 = f150(v0, 20u32);
                let a507 = 15u32;
                fixed_u32::bit_and(a506, a507)
            });
            let a527 = {
                let a524 = f149({
                    let a508 = f150(v0, 16u32);
                    let a509 = 15u32;
                    fixed_u32::bit_and(a508, a509)
                });
                let a525 = {
                    let a522 = f149({
                        let a510 = f150(v0, 12u32);
                        let a511 = 15u32;
                        fixed_u32::bit_and(a510, a511)
                    });
                    let a523 = {
                        let a520 = f149({
                            let a512 = f150(v0, 8u32);
                            let a513 = 15u32;
                            fixed_u32::bit_and(a512, a513)
                        });
                        let a521 = {
                            let a518 = f149({
                                let a514 = f150(v0, 4u32);
                                let a515 = 15u32;
                                fixed_u32::bit_and(a514, a515)
                            });
                            let a519 = f149({
                                let a516 = v0;
                                let a517 = 15u32;
                                fixed_u32::bit_and(a516, a517)
                            });
                            append_bytes(a518, a519)
                        };
                        append_bytes(a520, a521)
                    };
                    append_bytes(a522, a523)
                };
                append_bytes(a524, a525)
            };
            append_bytes(a526, a527)
        };
        append_bytes(a528, a529)
    };
    append_bytes(a530, a531)
}

pub fn f140(v0: Fn25, p535: u64, p536: (u64, Adt12)) -> R<(u64, Adt12)> {
    let m534 = (p535, p536);
    {
        let mut m534 = m534;
        loop {
            let step = {
                let (v1, v2) = m534;
                let m532 = v1;
                if m532 == 0 {
                    Err::<(u64, (u64, Adt12)), R<(u64, Adt12)>>(Ok(v2))
                } else {
                    let v3 = m532 - 1;
                    Ok::<(u64, (u64, Adt12)), R<(u64, Adt12)>>((v3, {
                        let c533: Fn25 = v0.clone();
                        c533.apply(v2)?
                    }))
                }
            };
            match step {
                Ok(next) => { m534 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f141(v0: Bytes, v1: u64, v2: u64, v3: (u64, Adt12)) -> R<(u64, Adt12)> {
    Ok(({
        let a538 = {
            let (h537, _) = v3.clone();
            h537
        };
        let a539 = 64u64;
        nat_add(a538, a539)?
    }, f151({
        let (_, h540) = v3;
        h540
    }, f152(v0, v1, v2, {
        let (h541, _) = v3;
        h541
    })?)?))
}

pub fn f142() -> Adt12 {
    Adt12::C0(1779033703u32, 3144134277u32, 1013904242u32, 2773480762u32, 1359893119u32, 2600822924u32, 528734635u32, 1541459225u32)
}

pub fn f143(v0: Fn26, p545: Option<Adt5>, p546: List<Adt5>) -> Option<Adt5> {
    let m544 = (p545, p546);
    {
        let mut m544 = m544;
        loop {
            let step = {
                let (v1, v2) = m544;
                let m542 = v2;
                match m542.uncons() {
                    None => {
                        Err::<(Option<Adt5>, List<Adt5>), Option<Adt5>>(v1)
                    }
                    Some((v3, v4)) => {
                        Ok::<(Option<Adt5>, List<Adt5>), Option<Adt5>>(({
                            let c543: Fn26 = v0.clone();
                            c543.apply(v1, v3)
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m544 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f144(v0: Str, v1: Option<Adt5>, v2: Adt5) -> Option<Adt5> {
    let a550 = {
        let m549 = match v2.clone() {
            Adt5::C0(h548, _, _) => {
                h548
            }
        };
        match m549 {
            Adt6::C0(h547, _, _, _, _, _) => {
                h547
            }
        }
    };
    let a551 = v0;
    if equal(a550, a551) {
        Some(v2)
    } else {
        v1
    }
}

pub fn f145(v0: Str, v1: List<Bytes>, v2: Str) -> List<Bytes> {
    List::cons(f29(List::cons(f55(v0), List::cons(f55(v2), List::<Bytes>::nil()))), v1)
}

pub fn f146(v0: List<Bytes>, v1: Adt5) -> List<Bytes> {
    List::cons(f29(List::cons(f55(Str::lit("needs")), List::cons(f55({
        let m554 = match v1.clone() {
            Adt5::C0(h553, _, _) => {
                h553
            }
        };
        match m554 {
            Adt6::C0(h552, _, _, _, _, _) => {
                h552
            }
        }
    }), List::cons(f55(match v1 {
        Adt5::C0(_, h555, _) => {
            h555
        }
    }), List::<Bytes>::nil())))), v0)
}

pub fn f147(v0: Fn27, p559: u64, p560: List<Str>) -> R<u64> {
    let m558 = (p559, p560);
    {
        let mut m558 = m558;
        loop {
            let step = {
                let (v1, v2) = m558;
                let m556 = v2;
                match m556.uncons() {
                    None => {
                        Err::<(u64, List<Str>), R<u64>>(Ok(v1))
                    }
                    Some((v3, v4)) => {
                        Ok::<(u64, List<Str>), R<u64>>(({
                            let c557: Fn27 = v0.clone();
                            c557.apply(v1, v3)?
                        }, v4))
                    }
                }
            };
            match step {
                Ok(next) => { m558 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f148(v0: bool, v1: Bytes, v2: u64, v3: Str) -> R<u64> {
    let a561 = f153(v3.clone(), Bytes::lit(&[0x21]));
    let a562 = v0;
    if equal(a561, a562) {
        let v4: u64 = f154(v3, v1)?;
        let a563 = v2;
        let a564 = v4;
        if nat_lt(a563, a564) {
            Ok(v4)
        } else {
            Ok(v2)
        }
    } else {
        Ok(v2)
    }
}

pub fn f149(v0: u32) -> Bytes {
    let a567 = {
        let a565 = v0;
        let a566 = 8u32;
        fixed_u32::bit_and(a565, a566)
    };
    let a568 = 0u32;
    if equal(a567, a568) {
        let a571 = {
            let a569 = v0;
            let a570 = 4u32;
            fixed_u32::bit_and(a569, a570)
        };
        let a572 = 0u32;
        if equal(a571, a572) {
            let a575 = {
                let a573 = v0;
                let a574 = 2u32;
                fixed_u32::bit_and(a573, a574)
            };
            let a576 = 0u32;
            if equal(a575, a576) {
                let a579 = {
                    let a577 = v0;
                    let a578 = 1u32;
                    fixed_u32::bit_and(a577, a578)
                };
                let a580 = 0u32;
                if equal(a579, a580) {
                    Bytes::lit(&[0x30])
                } else {
                    Bytes::lit(&[0x31])
                }
            } else {
                let a583 = {
                    let a581 = v0;
                    let a582 = 1u32;
                    fixed_u32::bit_and(a581, a582)
                };
                let a584 = 0u32;
                if equal(a583, a584) {
                    Bytes::lit(&[0x32])
                } else {
                    Bytes::lit(&[0x33])
                }
            }
        } else {
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
                    Bytes::lit(&[0x34])
                } else {
                    Bytes::lit(&[0x35])
                }
            } else {
                let a595 = {
                    let a593 = v0;
                    let a594 = 1u32;
                    fixed_u32::bit_and(a593, a594)
                };
                let a596 = 0u32;
                if equal(a595, a596) {
                    Bytes::lit(&[0x36])
                } else {
                    Bytes::lit(&[0x37])
                }
            }
        }
    } else {
        let a599 = {
            let a597 = v0;
            let a598 = 4u32;
            fixed_u32::bit_and(a597, a598)
        };
        let a600 = 0u32;
        if equal(a599, a600) {
            let a603 = {
                let a601 = v0;
                let a602 = 2u32;
                fixed_u32::bit_and(a601, a602)
            };
            let a604 = 0u32;
            if equal(a603, a604) {
                let a607 = {
                    let a605 = v0;
                    let a606 = 1u32;
                    fixed_u32::bit_and(a605, a606)
                };
                let a608 = 0u32;
                if equal(a607, a608) {
                    Bytes::lit(&[0x38])
                } else {
                    Bytes::lit(&[0x39])
                }
            } else {
                let a611 = {
                    let a609 = v0;
                    let a610 = 1u32;
                    fixed_u32::bit_and(a609, a610)
                };
                let a612 = 0u32;
                if equal(a611, a612) {
                    Bytes::lit(&[0x61])
                } else {
                    Bytes::lit(&[0x62])
                }
            }
        } else {
            let a615 = {
                let a613 = v0;
                let a614 = 2u32;
                fixed_u32::bit_and(a613, a614)
            };
            let a616 = 0u32;
            if equal(a615, a616) {
                let a619 = {
                    let a617 = v0;
                    let a618 = 1u32;
                    fixed_u32::bit_and(a617, a618)
                };
                let a620 = 0u32;
                if equal(a619, a620) {
                    Bytes::lit(&[0x63])
                } else {
                    Bytes::lit(&[0x64])
                }
            } else {
                let a623 = {
                    let a621 = v0;
                    let a622 = 1u32;
                    fixed_u32::bit_and(a621, a622)
                };
                let a624 = 0u32;
                if equal(a623, a624) {
                    Bytes::lit(&[0x65])
                } else {
                    Bytes::lit(&[0x66])
                }
            }
        }
    }
}

pub fn f150(v0: u32, v1: u32) -> u32 {
    let m627 = {
        let a625 = v0;
        let a626 = v1;
        fixed_u32::shift_right(a625, a626)
    };
    match m627 {
        None => {
            0u32
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f151(v0: Adt12, v1: Adt13) -> R<Adt12> {
    let v2: Adt14 = f155(Fn28::F156, 64u64, Adt14::C0(match v0.clone() {
        Adt12::C0(h628, _, _, _, _, _, _, _) => {
            h628
        }
    }, match v0.clone() {
        Adt12::C0(_, h629, _, _, _, _, _, _) => {
            h629
        }
    }, match v0.clone() {
        Adt12::C0(_, _, h630, _, _, _, _, _) => {
            h630
        }
    }, match v0.clone() {
        Adt12::C0(_, _, _, h631, _, _, _, _) => {
            h631
        }
    }, match v0.clone() {
        Adt12::C0(_, _, _, _, h632, _, _, _) => {
            h632
        }
    }, match v0.clone() {
        Adt12::C0(_, _, _, _, _, h633, _, _) => {
            h633
        }
    }, match v0.clone() {
        Adt12::C0(_, _, _, _, _, _, h634, _) => {
            h634
        }
    }, match v0.clone() {
        Adt12::C0(_, _, _, _, _, _, _, h635) => {
            h635
        }
    }, v1, 0u64))?;
    Ok(Adt12::C0(f157(match v0.clone() {
        Adt12::C0(h636, _, _, _, _, _, _, _) => {
            h636
        }
    }, match v2.clone() {
        Adt14::C0(h637, _, _, _, _, _, _, _, _, _) => {
            h637
        }
    }), f157(match v0.clone() {
        Adt12::C0(_, h638, _, _, _, _, _, _) => {
            h638
        }
    }, match v2.clone() {
        Adt14::C0(_, h639, _, _, _, _, _, _, _, _) => {
            h639
        }
    }), f157(match v0.clone() {
        Adt12::C0(_, _, h640, _, _, _, _, _) => {
            h640
        }
    }, match v2.clone() {
        Adt14::C0(_, _, h641, _, _, _, _, _, _, _) => {
            h641
        }
    }), f157(match v0.clone() {
        Adt12::C0(_, _, _, h642, _, _, _, _) => {
            h642
        }
    }, match v2.clone() {
        Adt14::C0(_, _, _, h643, _, _, _, _, _, _) => {
            h643
        }
    }), f157(match v0.clone() {
        Adt12::C0(_, _, _, _, h644, _, _, _) => {
            h644
        }
    }, match v2.clone() {
        Adt14::C0(_, _, _, _, h645, _, _, _, _, _) => {
            h645
        }
    }), f157(match v0.clone() {
        Adt12::C0(_, _, _, _, _, h646, _, _) => {
            h646
        }
    }, match v2.clone() {
        Adt14::C0(_, _, _, _, _, h647, _, _, _, _) => {
            h647
        }
    }), f157(match v0.clone() {
        Adt12::C0(_, _, _, _, _, _, h648, _) => {
            h648
        }
    }, match v2.clone() {
        Adt14::C0(_, _, _, _, _, _, h649, _, _, _) => {
            h649
        }
    }), f157(match v0 {
        Adt12::C0(_, _, _, _, _, _, _, h650) => {
            h650
        }
    }, match v2 {
        Adt14::C0(_, _, _, _, _, _, _, h651, _, _) => {
            h651
        }
    })))
}

pub fn f152(v0: Bytes, v1: u64, v2: u64, v3: u64) -> R<Adt13> {
    Ok(Adt13::C0(f158(v0.clone(), v1, v2, v3)?, f158(v0.clone(), v1, v2, {
        let a652 = v3;
        let a653 = 4u64;
        nat_add(a652, a653)?
    })?, f158(v0.clone(), v1, v2, {
        let a654 = v3;
        let a655 = 8u64;
        nat_add(a654, a655)?
    })?, f158(v0.clone(), v1, v2, {
        let a656 = v3;
        let a657 = 12u64;
        nat_add(a656, a657)?
    })?, f158(v0.clone(), v1, v2, {
        let a658 = v3;
        let a659 = 16u64;
        nat_add(a658, a659)?
    })?, f158(v0.clone(), v1, v2, {
        let a660 = v3;
        let a661 = 20u64;
        nat_add(a660, a661)?
    })?, f158(v0.clone(), v1, v2, {
        let a662 = v3;
        let a663 = 24u64;
        nat_add(a662, a663)?
    })?, f158(v0.clone(), v1, v2, {
        let a664 = v3;
        let a665 = 28u64;
        nat_add(a664, a665)?
    })?, f158(v0.clone(), v1, v2, {
        let a666 = v3;
        let a667 = 32u64;
        nat_add(a666, a667)?
    })?, f158(v0.clone(), v1, v2, {
        let a668 = v3;
        let a669 = 36u64;
        nat_add(a668, a669)?
    })?, f158(v0.clone(), v1, v2, {
        let a670 = v3;
        let a671 = 40u64;
        nat_add(a670, a671)?
    })?, f158(v0.clone(), v1, v2, {
        let a672 = v3;
        let a673 = 44u64;
        nat_add(a672, a673)?
    })?, f158(v0.clone(), v1, v2, {
        let a674 = v3;
        let a675 = 48u64;
        nat_add(a674, a675)?
    })?, f158(v0.clone(), v1, v2, {
        let a676 = v3;
        let a677 = 52u64;
        nat_add(a676, a677)?
    })?, f158(v0.clone(), v1, v2, {
        let a678 = v3;
        let a679 = 56u64;
        nat_add(a678, a679)?
    })?, f158(v0, v1, v2, {
        let a680 = v3;
        let a681 = 60u64;
        nat_add(a680, a681)?
    })?))
}

pub fn f153(v0: Str, v1: Bytes) -> bool {
    f159(f55(v0), v1)
}

pub fn f154(v0: Str, v1: Bytes) -> R<u64> {
    let v2: Bytes = if f153(v0.clone(), Bytes::lit(&[0x21])) {
        f160(v0)
    } else {
        f55(v0)
    };
    if f159(v1.clone(), v2.clone()) {
        if f159(v1, Bytes::lit(&[0x40])) {
            if f159(v2.clone(), Bytes::lit(&[0x40])) {
                let a683 = {
                    let a682 = v2;
                    length_bytes(a682)
                };
                let a684 = 1u64;
                nat_add(a683, a684)
            } else {
                Ok(0u64)
            }
        } else {
            let a686 = {
                let a685 = v2;
                length_bytes(a685)
            };
            let a687 = 1u64;
            nat_add(a686, a687)
        }
    } else {
        Ok(0u64)
    }
}

pub fn f155(v0: Fn28, p691: u64, p692: Adt14) -> R<Adt14> {
    let m690 = (p691, p692);
    {
        let mut m690 = m690;
        loop {
            let step = {
                let (v1, v2) = m690;
                let m688 = v1;
                if m688 == 0 {
                    Err::<(u64, Adt14), R<Adt14>>(Ok(v2))
                } else {
                    let v3 = m688 - 1;
                    Ok::<(u64, Adt14), R<Adt14>>((v3, {
                        let c689: Fn28 = v0.clone();
                        c689.apply(v2)?
                    }))
                }
            };
            match step {
                Ok(next) => { m690 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f156(v0: Adt14) -> R<Adt14> {
    f161(v0)
}

pub fn f157(v0: u32, v1: u32) -> u32 {
    let m695 = {
        let a693 = f162(v0);
        let a694 = f162(v1);
        fixed_u64::checked_add(a693, a694)
    };
    match m695 {
        None => {
            0u32
        }
        Some(v2) => {
            f163(v2)
        }
    }
}

pub fn f158(v0: Bytes, v1: u64, v2: u64, v3: u64) -> R<u32> {
    let a698 = {
        let a696 = v3;
        let a697 = 8u64;
        nat_add(a696, a697)?
    };
    let a699 = v2;
    if nat_eq(a698, a699) {
        Ok(f164({
            let a702 = {
                let a700 = v1;
                let a701 = 8u64;
                nat_mul(a700, a701)?
            };
            let a703 = 4294967296u64;
            let a704 = 0u64;
            nat_quot(a702, a703, a704)
        }))
    } else {
        let a707 = {
            let a705 = v3;
            let a706 = 4u64;
            nat_add(a705, a706)?
        };
        let a708 = v2;
        if nat_eq(a707, a708) {
            Ok(f164({
                let a711 = {
                    let a709 = v1;
                    let a710 = 8u64;
                    nat_mul(a709, a710)?
                };
                let a712 = 4294967296u64;
                let a713 = 0u64;
                nat_rem(a711, a712, a713)
            }))
        } else {
            Ok(f165(f166(v0.clone(), v1, v3), f166(v0.clone(), v1, {
                let a714 = v3;
                let a715 = 1u64;
                nat_add(a714, a715)?
            }), f166(v0.clone(), v1, {
                let a716 = v3;
                let a717 = 2u64;
                nat_add(a716, a717)?
            }), f166(v0, v1, {
                let a718 = v3;
                let a719 = 3u64;
                nat_add(a718, a719)?
            })))
        }
    }
}

pub fn f159(v0: Bytes, v1: Bytes) -> bool {
    let m724 = {
        let a721 = v0;
        let a722 = 0u64;
        let a723 = {
            let a720 = v1.clone();
            length_bytes(a720)
        };
        slice_bytes(a721, a722, a723)
    };
    match m724 {
        None => {
            false
        }
        Some(v2) => {
            let a725 = v2;
            let a726 = v1;
            equal(a725, a726)
        }
    }
}

pub fn f160(v0: Str) -> Bytes {
    let v1: Bytes = f55(v0);
    f37(v1.clone(), 1u64, {
        let a728 = {
            let a727 = v1;
            length_bytes(a727)
        };
        let a729 = 1u64;
        nat_sub(a728, a729)
    })
}

pub fn f161(v0: Adt14) -> R<Adt14> {
    let v1: u32 = f167(match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, _, h730) => {
            h730
        }
    });
    let v2: u32 = f157(match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, h731, _, _) => {
            h731
        }
    }, f157(f168(match v0.clone() {
        Adt14::C0(_, _, _, _, h732, _, _, _, _, _) => {
            h732
        }
    }), f157(f169(match v0.clone() {
        Adt14::C0(_, _, _, _, h733, _, _, _, _, _) => {
            h733
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, h734, _, _, _, _) => {
            h734
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, h735, _, _, _) => {
            h735
        }
    }), f157(v1, {
        let m738 = match v0.clone() {
            Adt14::C0(_, _, _, _, _, _, _, _, h737, _) => {
                h737
            }
        };
        match m738 {
            Adt13::C0(h736, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
                h736
            }
        }
    }))));
    let v3: u32 = f157(f170(match v0.clone() {
        Adt14::C0(h739, _, _, _, _, _, _, _, _, _) => {
            h739
        }
    }), f171(match v0.clone() {
        Adt14::C0(h740, _, _, _, _, _, _, _, _, _) => {
            h740
        }
    }, match v0.clone() {
        Adt14::C0(_, h741, _, _, _, _, _, _, _, _) => {
            h741
        }
    }, match v0.clone() {
        Adt14::C0(_, _, h742, _, _, _, _, _, _, _) => {
            h742
        }
    }));
    Ok(Adt14::C0(f157(v2, v3), match v0.clone() {
        Adt14::C0(h743, _, _, _, _, _, _, _, _, _) => {
            h743
        }
    }, match v0.clone() {
        Adt14::C0(_, h744, _, _, _, _, _, _, _, _) => {
            h744
        }
    }, match v0.clone() {
        Adt14::C0(_, _, h745, _, _, _, _, _, _, _) => {
            h745
        }
    }, f157(match v0.clone() {
        Adt14::C0(_, _, _, h746, _, _, _, _, _, _) => {
            h746
        }
    }, v2), match v0.clone() {
        Adt14::C0(_, _, _, _, h747, _, _, _, _, _) => {
            h747
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, h748, _, _, _, _) => {
            h748
        }
    }, match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, h749, _, _, _) => {
            h749
        }
    }, f172(match v0.clone() {
        Adt14::C0(_, _, _, _, _, _, _, _, h750, _) => {
            h750
        }
    }), {
        let a752 = match v0 {
            Adt14::C0(_, _, _, _, _, _, _, _, _, h751) => {
                h751
            }
        };
        let a753 = 1u64;
        nat_add(a752, a753)?
    }))
}

pub fn f162(v0: u32) -> u64 {
    let m755 = {
        let a754 = v0;
        fixed_u64::convert(i128::from(a754))
    };
    match m755 {
        None => {
            0u64
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f163(v0: u64) -> u32 {
    let m759 = {
        let a758 = {
            let a756 = v0;
            let a757 = 4294967295u64;
            fixed_u64::bit_and(a756, a757)
        };
        fixed_u32::convert(i128::from(a758))
    };
    match m759 {
        None => {
            0u32
        }
        Some(v1) => {
            v1
        }
    }
}

pub fn f164(v0: u64) -> u32 {
    let (_, h760) = {
        let (_, h761) = f173(Fn29::F174, 32u64, (v0, (1u32, 0u32)));
        h761
    };
    h760
}

pub fn f165(v0: u32, v1: u32, v2: u32, v3: u32) -> u32 {
    let a766 = f175(v0, 24u32);
    let a767 = {
        let a764 = f175(v1, 16u32);
        let a765 = {
            let a762 = f175(v2, 8u32);
            let a763 = v3;
            fixed_u32::bit_or(a762, a763)
        };
        fixed_u32::bit_or(a764, a765)
    };
    fixed_u32::bit_or(a766, a767)
}

pub fn f166(v0: Bytes, v1: u64, v2: u64) -> u32 {
    let a768 = v2;
    let a769 = v1;
    if nat_lt(a768, a769) {
        let m772 = {
            let a770 = v0;
            let a771 = v2;
            index_bytes(a770, a771)
        };
        match m772 {
            None => {
                0u32
            }
            Some(v3) => {
                let m774 = {
                    let a773 = v3;
                    fixed_u32::convert(i128::from(a773))
                };
                match m774 {
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
        let a775 = v2;
        let a776 = v1;
        if nat_eq(a775, a776) {
            128u32
        } else {
            0u32
        }
    }
}

pub fn f167(v0: u64) -> u32 {
    let a777 = v0;
    let a778 = 32u64;
    if nat_lt(a777, a778) {
        let a779 = v0;
        let a780 = 16u64;
        if nat_lt(a779, a780) {
            let a781 = v0;
            let a782 = 8u64;
            if nat_lt(a781, a782) {
                let a783 = v0;
                let a784 = 4u64;
                if nat_lt(a783, a784) {
                    let a785 = v0;
                    let a786 = 2u64;
                    if nat_lt(a785, a786) {
                        let a787 = v0;
                        let a788 = 1u64;
                        if nat_lt(a787, a788) {
                            1116352408u32
                        } else {
                            1899447441u32
                        }
                    } else {
                        let a789 = v0;
                        let a790 = 3u64;
                        if nat_lt(a789, a790) {
                            3049323471u32
                        } else {
                            3921009573u32
                        }
                    }
                } else {
                    let a791 = v0;
                    let a792 = 6u64;
                    if nat_lt(a791, a792) {
                        let a793 = v0;
                        let a794 = 5u64;
                        if nat_lt(a793, a794) {
                            961987163u32
                        } else {
                            1508970993u32
                        }
                    } else {
                        let a795 = v0;
                        let a796 = 7u64;
                        if nat_lt(a795, a796) {
                            2453635748u32
                        } else {
                            2870763221u32
                        }
                    }
                }
            } else {
                let a797 = v0;
                let a798 = 12u64;
                if nat_lt(a797, a798) {
                    let a799 = v0;
                    let a800 = 10u64;
                    if nat_lt(a799, a800) {
                        let a801 = v0;
                        let a802 = 9u64;
                        if nat_lt(a801, a802) {
                            3624381080u32
                        } else {
                            310598401u32
                        }
                    } else {
                        let a803 = v0;
                        let a804 = 11u64;
                        if nat_lt(a803, a804) {
                            607225278u32
                        } else {
                            1426881987u32
                        }
                    }
                } else {
                    let a805 = v0;
                    let a806 = 14u64;
                    if nat_lt(a805, a806) {
                        let a807 = v0;
                        let a808 = 13u64;
                        if nat_lt(a807, a808) {
                            1925078388u32
                        } else {
                            2162078206u32
                        }
                    } else {
                        let a809 = v0;
                        let a810 = 15u64;
                        if nat_lt(a809, a810) {
                            2614888103u32
                        } else {
                            3248222580u32
                        }
                    }
                }
            }
        } else {
            let a811 = v0;
            let a812 = 24u64;
            if nat_lt(a811, a812) {
                let a813 = v0;
                let a814 = 20u64;
                if nat_lt(a813, a814) {
                    let a815 = v0;
                    let a816 = 18u64;
                    if nat_lt(a815, a816) {
                        let a817 = v0;
                        let a818 = 17u64;
                        if nat_lt(a817, a818) {
                            3835390401u32
                        } else {
                            4022224774u32
                        }
                    } else {
                        let a819 = v0;
                        let a820 = 19u64;
                        if nat_lt(a819, a820) {
                            264347078u32
                        } else {
                            604807628u32
                        }
                    }
                } else {
                    let a821 = v0;
                    let a822 = 22u64;
                    if nat_lt(a821, a822) {
                        let a823 = v0;
                        let a824 = 21u64;
                        if nat_lt(a823, a824) {
                            770255983u32
                        } else {
                            1249150122u32
                        }
                    } else {
                        let a825 = v0;
                        let a826 = 23u64;
                        if nat_lt(a825, a826) {
                            1555081692u32
                        } else {
                            1996064986u32
                        }
                    }
                }
            } else {
                let a827 = v0;
                let a828 = 28u64;
                if nat_lt(a827, a828) {
                    let a829 = v0;
                    let a830 = 26u64;
                    if nat_lt(a829, a830) {
                        let a831 = v0;
                        let a832 = 25u64;
                        if nat_lt(a831, a832) {
                            2554220882u32
                        } else {
                            2821834349u32
                        }
                    } else {
                        let a833 = v0;
                        let a834 = 27u64;
                        if nat_lt(a833, a834) {
                            2952996808u32
                        } else {
                            3210313671u32
                        }
                    }
                } else {
                    let a835 = v0;
                    let a836 = 30u64;
                    if nat_lt(a835, a836) {
                        let a837 = v0;
                        let a838 = 29u64;
                        if nat_lt(a837, a838) {
                            3336571891u32
                        } else {
                            3584528711u32
                        }
                    } else {
                        let a839 = v0;
                        let a840 = 31u64;
                        if nat_lt(a839, a840) {
                            113926993u32
                        } else {
                            338241895u32
                        }
                    }
                }
            }
        }
    } else {
        let a841 = v0;
        let a842 = 48u64;
        if nat_lt(a841, a842) {
            let a843 = v0;
            let a844 = 40u64;
            if nat_lt(a843, a844) {
                let a845 = v0;
                let a846 = 36u64;
                if nat_lt(a845, a846) {
                    let a847 = v0;
                    let a848 = 34u64;
                    if nat_lt(a847, a848) {
                        let a849 = v0;
                        let a850 = 33u64;
                        if nat_lt(a849, a850) {
                            666307205u32
                        } else {
                            773529912u32
                        }
                    } else {
                        let a851 = v0;
                        let a852 = 35u64;
                        if nat_lt(a851, a852) {
                            1294757372u32
                        } else {
                            1396182291u32
                        }
                    }
                } else {
                    let a853 = v0;
                    let a854 = 38u64;
                    if nat_lt(a853, a854) {
                        let a855 = v0;
                        let a856 = 37u64;
                        if nat_lt(a855, a856) {
                            1695183700u32
                        } else {
                            1986661051u32
                        }
                    } else {
                        let a857 = v0;
                        let a858 = 39u64;
                        if nat_lt(a857, a858) {
                            2177026350u32
                        } else {
                            2456956037u32
                        }
                    }
                }
            } else {
                let a859 = v0;
                let a860 = 44u64;
                if nat_lt(a859, a860) {
                    let a861 = v0;
                    let a862 = 42u64;
                    if nat_lt(a861, a862) {
                        let a863 = v0;
                        let a864 = 41u64;
                        if nat_lt(a863, a864) {
                            2730485921u32
                        } else {
                            2820302411u32
                        }
                    } else {
                        let a865 = v0;
                        let a866 = 43u64;
                        if nat_lt(a865, a866) {
                            3259730800u32
                        } else {
                            3345764771u32
                        }
                    }
                } else {
                    let a867 = v0;
                    let a868 = 46u64;
                    if nat_lt(a867, a868) {
                        let a869 = v0;
                        let a870 = 45u64;
                        if nat_lt(a869, a870) {
                            3516065817u32
                        } else {
                            3600352804u32
                        }
                    } else {
                        let a871 = v0;
                        let a872 = 47u64;
                        if nat_lt(a871, a872) {
                            4094571909u32
                        } else {
                            275423344u32
                        }
                    }
                }
            }
        } else {
            let a873 = v0;
            let a874 = 56u64;
            if nat_lt(a873, a874) {
                let a875 = v0;
                let a876 = 52u64;
                if nat_lt(a875, a876) {
                    let a877 = v0;
                    let a878 = 50u64;
                    if nat_lt(a877, a878) {
                        let a879 = v0;
                        let a880 = 49u64;
                        if nat_lt(a879, a880) {
                            430227734u32
                        } else {
                            506948616u32
                        }
                    } else {
                        let a881 = v0;
                        let a882 = 51u64;
                        if nat_lt(a881, a882) {
                            659060556u32
                        } else {
                            883997877u32
                        }
                    }
                } else {
                    let a883 = v0;
                    let a884 = 54u64;
                    if nat_lt(a883, a884) {
                        let a885 = v0;
                        let a886 = 53u64;
                        if nat_lt(a885, a886) {
                            958139571u32
                        } else {
                            1322822218u32
                        }
                    } else {
                        let a887 = v0;
                        let a888 = 55u64;
                        if nat_lt(a887, a888) {
                            1537002063u32
                        } else {
                            1747873779u32
                        }
                    }
                }
            } else {
                let a889 = v0;
                let a890 = 60u64;
                if nat_lt(a889, a890) {
                    let a891 = v0;
                    let a892 = 58u64;
                    if nat_lt(a891, a892) {
                        let a893 = v0;
                        let a894 = 57u64;
                        if nat_lt(a893, a894) {
                            1955562222u32
                        } else {
                            2024104815u32
                        }
                    } else {
                        let a895 = v0;
                        let a896 = 59u64;
                        if nat_lt(a895, a896) {
                            2227730452u32
                        } else {
                            2361852424u32
                        }
                    }
                } else {
                    let a897 = v0;
                    let a898 = 62u64;
                    if nat_lt(a897, a898) {
                        let a899 = v0;
                        let a900 = 61u64;
                        if nat_lt(a899, a900) {
                            2428436474u32
                        } else {
                            2756734187u32
                        }
                    } else {
                        let a901 = v0;
                        let a902 = 63u64;
                        if nat_lt(a901, a902) {
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

pub fn f168(v0: u32) -> u32 {
    let a905 = {
        let a903 = f176(v0, 6u32, 26u32);
        let a904 = f176(v0, 11u32, 21u32);
        fixed_u32::bit_xor(a903, a904)
    };
    let a906 = f176(v0, 25u32, 7u32);
    fixed_u32::bit_xor(a905, a906)
}

pub fn f169(v0: u32, v1: u32, v2: u32) -> u32 {
    let a912 = {
        let a907 = v0;
        let a908 = v1;
        fixed_u32::bit_and(a907, a908)
    };
    let a913 = {
        let a910 = {
            let a909 = v0;
            fixed_u32::bit_not(a909)
        };
        let a911 = v2;
        fixed_u32::bit_and(a910, a911)
    };
    fixed_u32::bit_xor(a912, a913)
}

pub fn f170(v0: u32) -> u32 {
    let a916 = {
        let a914 = f176(v0, 2u32, 30u32);
        let a915 = f176(v0, 13u32, 19u32);
        fixed_u32::bit_xor(a914, a915)
    };
    let a917 = f176(v0, 22u32, 10u32);
    fixed_u32::bit_xor(a916, a917)
}

pub fn f171(v0: u32, v1: u32, v2: u32) -> u32 {
    let a926 = {
        let a922 = {
            let a918 = v0;
            let a919 = v1;
            fixed_u32::bit_and(a918, a919)
        };
        let a923 = {
            let a920 = v0;
            let a921 = v2;
            fixed_u32::bit_and(a920, a921)
        };
        fixed_u32::bit_xor(a922, a923)
    };
    let a927 = {
        let a924 = v1;
        let a925 = v2;
        fixed_u32::bit_and(a924, a925)
    };
    fixed_u32::bit_xor(a926, a927)
}

pub fn f172(v0: Adt13) -> Adt13 {
    Adt13::C0(match v0.clone() {
        Adt13::C0(_, h928, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h928
        }
    }, match v0.clone() {
        Adt13::C0(_, _, h929, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h929
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, h930, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h930
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, h931, _, _, _, _, _, _, _, _, _, _, _) => {
            h931
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, h932, _, _, _, _, _, _, _, _, _, _) => {
            h932
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, h933, _, _, _, _, _, _, _, _, _) => {
            h933
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, h934, _, _, _, _, _, _, _, _) => {
            h934
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, h935, _, _, _, _, _, _, _) => {
            h935
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, h936, _, _, _, _, _, _) => {
            h936
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, h937, _, _, _, _, _) => {
            h937
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, h938, _, _, _, _) => {
            h938
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, _, h939, _, _, _) => {
            h939
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, h940, _, _) => {
            h940
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h941, _) => {
            h941
        }
    }, match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, h942) => {
            h942
        }
    }, f157(f177(match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, _, _, _, _, _, h943, _) => {
            h943
        }
    }), f157(match v0.clone() {
        Adt13::C0(_, _, _, _, _, _, _, _, _, h944, _, _, _, _, _, _) => {
            h944
        }
    }, f157(f178(match v0.clone() {
        Adt13::C0(_, h945, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h945
        }
    }), match v0 {
        Adt13::C0(h946, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) => {
            h946
        }
    }))))
}

pub fn f173(v0: Fn29, p950: u64, p951: (u64, (u32, u32))) -> (u64, (u32, u32)) {
    let m949 = (p950, p951);
    {
        let mut m949 = m949;
        loop {
            let step = {
                let (v1, v2) = m949;
                let m947 = v1;
                if m947 == 0 {
                    Err::<(u64, (u64, (u32, u32))), (u64, (u32, u32))>(v2)
                } else {
                    let v3 = m947 - 1;
                    Ok::<(u64, (u64, (u32, u32))), (u64, (u32, u32))>((v3, {
                        let c948: Fn29 = v0.clone();
                        c948.apply(v2)
                    }))
                }
            };
            match step {
                Ok(next) => { m949 = next; }
                Err(done) => break done,
            }
        }
    }
}

pub fn f174(v0: (u64, (u32, u32))) -> (u64, (u32, u32)) {
    let v1: u64 = {
        let (h952, _) = v0;
        h952
    };
    let v2: u32 = {
        let (h953, _) = {
            let (_, h954) = v0;
            h954
        };
        h953
    };
    let v3: u32 = {
        let (_, h955) = {
            let (_, h956) = v0;
            h956
        };
        h955
    };
    ({
        let a957 = v1;
        let a958 = 2u64;
        let a959 = 0u64;
        nat_quot(a957, a958, a959)
    }, (f175(v2, 1u32), {
        let a963 = {
            let a960 = v1;
            let a961 = 2u64;
            let a962 = 0u64;
            nat_rem(a960, a961, a962)
        };
        let a964 = 1u64;
        if nat_eq(a963, a964) {
            let a965 = v3;
            let a966 = v2;
            fixed_u32::bit_or(a965, a966)
        } else {
            v3
        }
    }))
}

pub fn f175(v0: u32, v1: u32) -> u32 {
    let m969 = {
        let a967 = v0;
        let a968 = v1;
        fixed_u32::shift_left(a967, a968)
    };
    match m969 {
        None => {
            0u32
        }
        Some(v2) => {
            v2
        }
    }
}

pub fn f176(v0: u32, v1: u32, v2: u32) -> u32 {
    let a970 = f150(v0, v1);
    let a971 = f175(v0, v2);
    fixed_u32::bit_or(a970, a971)
}

pub fn f177(v0: u32) -> u32 {
    let a974 = {
        let a972 = f176(v0, 17u32, 15u32);
        let a973 = f176(v0, 19u32, 13u32);
        fixed_u32::bit_xor(a972, a973)
    };
    let a975 = f150(v0, 10u32);
    fixed_u32::bit_xor(a974, a975)
}

pub fn f178(v0: u32) -> u32 {
    let a978 = {
        let a976 = f176(v0, 7u32, 25u32);
        let a977 = f176(v0, 18u32, 14u32);
        fixed_u32::bit_xor(a976, a977)
    };
    let a979 = f150(v0, 3u32);
    fixed_u32::bit_xor(a978, a979)
}

pub fn run(p0: Bytes) -> R<Bytes> {
    f0(p0)
}
