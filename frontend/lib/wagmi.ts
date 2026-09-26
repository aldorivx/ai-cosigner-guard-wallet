import { http, createConfig } from "wagmi";
import { bscTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors/injected";

export const wagmiConfig = createConfig({
  chains: [bscTestnet],
  connectors: [
    injected(),
  ],
  transports: {
    [bscTestnet.id]: http("https://bsc-testnet-rpc.publicnode.com"),
  },
  ssr: true,
});
