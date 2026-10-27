// Nur Entwicklung: kleiner MQTT-Broker (1883 + WebSocket 9001) statt Mosquitto.
import { Aedes } from "aedes";
import { createServer } from "node:net";
import { WebSocketServer, createWebSocketStream } from "ws";

const aedes = await Aedes.createBroker();
createServer(aedes.handle).listen(1883, () => console.log("MQTT 1883"));
new WebSocketServer({ port: 9001 }).on("connection", (socket, req) => aedes.handle(createWebSocketStream(socket), req));
console.log("WebSocket 9001");
