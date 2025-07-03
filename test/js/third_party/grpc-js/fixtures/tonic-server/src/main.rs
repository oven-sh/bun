use tonic::{transport::Server, Request, Response, Status};
use helloworld::greeter_server::{Greeter, GreeterServer};
use helloworld::{HelloRequest, HelloReply};
use tokio::net::TcpListener;

pub mod helloworld {
    tonic::include_proto!("helloworld");
}

#[derive(Default)]
pub struct MyGreeter {}

#[tonic::async_trait]
impl Greeter for MyGreeter {
    async fn say_hello(
        &self,
        request: Request<HelloRequest>,
    ) -> Result<Response<HelloReply>, Status> {
        let reply = HelloReply {
            message:  request.into_inner().name,
        };
        Ok(Response::new(reply))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let greeter = MyGreeter::default();
    let mut server: Server = Server::builder();
    println!("Listening on {}", addr);
    server.add_service(GreeterServer::new(greeter))
    .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
    .await?;
    
    
    Ok(())
}
