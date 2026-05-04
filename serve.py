import http.server, os
os.chdir('/Users/nitingoel/Desktop/Maintenance')
http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=8765, bind='127.0.0.1')
