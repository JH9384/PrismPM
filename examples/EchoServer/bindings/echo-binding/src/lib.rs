//! The host of the echo server: the effect its request frame asks for and the one
//! its core requests.

use echo_server_host_api::protocol::{echo_stamp, tool_calls, Host, HostError};

/// The stamp every exchange of this host carries. A real host would read a
/// clock; the example's is a constant, so the acceptance reproduces its bytes.
pub const STAMP: u64 = 7;

/// Counts the requests the adapter marks as counted.
#[derive(Default)]
pub struct Native {
    calls: u64,
}

impl Host for Native {
    fn tool_calls(
        &mut self,
        request: tool_calls::Request,
    ) -> Result<tool_calls::Completed, HostError<tool_calls::Failure>> {
        if request.counted {
            self.calls += 1;
        }
        Ok(tool_calls::Completed { calls: self.calls })
    }

    fn echo_stamp(
        &mut self,
        _request: echo_stamp::Request,
    ) -> Result<echo_stamp::Completed, HostError<echo_stamp::Failure>> {
        Ok(echo_stamp::Completed { stamp: STAMP })
    }
}
