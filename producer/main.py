import asyncio
import json
import logging
import os
import signal
import sys
from contextlib import suppress

import websockets
from azure.eventhub import EventData
from azure.eventhub.aio import EventHubProducerClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("producer")

EH_CONN = os.environ["EVENTHUB_CONNECTION_STRING"]
EH_NAME = os.environ["EVENTHUB_NAME"]
WS_URL = os.environ.get("COINBASE_WS_URL", "wss://ws-feed.exchange.coinbase.com")
SYMBOLS = [s.strip() for s in os.environ.get("SYMBOLS", "BTC-USD").split(",") if s.strip()]

BATCH_FLUSH_INTERVAL = 1.0
RECONNECT_BACKOFF = (1, 2, 5, 10, 30)


async def stream(producer, shutdown):
    subscribe_msg = json.dumps({
        "type": "subscribe",
        "product_ids": SYMBOLS,
        "channels": ["matches"],
    })

    async with websockets.connect(WS_URL, ping_interval=20, ping_timeout=20) as ws:
        await ws.send(subscribe_msg)
        log.info("subscribed to %s", SYMBOLS)

        batch = await producer.create_batch()
        loop = asyncio.get_event_loop()
        last_flush = loop.time()
        sent = 0

        async for raw in ws:
            if shutdown.is_set():
                break
            msg = json.loads(raw)
            if msg.get("type") != "match":
                continue

            event = EventData(raw)
            try:
                batch.add(event)
            except ValueError:
                await producer.send_batch(batch)
                sent += len(batch)
                batch = await producer.create_batch()
                batch.add(event)

            now = loop.time()
            if now - last_flush >= BATCH_FLUSH_INTERVAL and len(batch) > 0:
                await producer.send_batch(batch)
                sent += len(batch)
                log.info("flushed batch — total sent %s", sent)
                batch = await producer.create_batch()
                last_flush = now

        if len(batch) > 0:
            await producer.send_batch(batch)


async def run():
    shutdown = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, shutdown.set)

    producer = EventHubProducerClient.from_connection_string(EH_CONN, eventhub_name=EH_NAME)
    async with producer:
        attempt = 0
        while not shutdown.is_set():
            try:
                await stream(producer, shutdown)
                attempt = 0
            except Exception as e:
                delay = RECONNECT_BACKOFF[min(attempt, len(RECONNECT_BACKOFF) - 1)]
                log.warning("disconnected (%s); reconnecting in %ss", e, delay)
                attempt += 1
                with suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(shutdown.wait(), timeout=delay)
    log.info("shutdown complete")


if __name__ == "__main__":
    asyncio.run(run())
