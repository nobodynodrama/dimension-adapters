import { BreakdownAdapter } from "../../adapters/types";
import { CHAIN } from "../../helpers/chains";
import axios from "axios";

interface IVolumeall {
  timestamp: string;
  volume: string;
  close_x18: string;
}

interface IProducts {
  spot_products: number[];
  perp_products: number[];
  margined_products: number[];
}

const gatewayBaseUrl = "https://gateway.prod.vertexprotocol.com/v1";
const archiveBaseUrl = "https://archive.prod.vertexprotocol.com/v1";

const fetchValidSymbols = async (): Promise<number[]> => {
  const symbols = (await axios.get(`${gatewayBaseUrl}/symbols`)).data;
  return symbols.map((product: { product_id: number }) => product.product_id);
};

const fetchProducts = async (): Promise<IProducts> => {
  const validSymbols = await fetchValidSymbols();
  const allProducts = (
    await axios.get(`${gatewayBaseUrl}/query?type=all_products`)
  ).data.data;
  return {
    spot_products: allProducts.spot_products
      .map((product: { product_id: number }) => product.product_id)
      .filter((id: number) => validSymbols.includes(id) && id > 0),
    perp_products: allProducts.perp_products
      .map((product: { product_id: number }) => product.product_id)
      .filter((id: number) => validSymbols.includes(id)),
    margined_products: allProducts.spot_products
      .map((product: { product_id: number }) => product.product_id)
      .filter((id: number) => validSymbols.includes(id) && id > 0),
  };
};

const computeVolume = async (timestamp: number, productIds: number[]) => {
  const snapshots = (
    await axios.post(archiveBaseUrl, {
      market_snapshots: {
        interval: {
          count: 2,
          granularity: 86400,
          max_time: timestamp,
        },
        product_ids: productIds,
      },
    })
  ).data.snapshots;
  const lastCumulativeVolumes: Record<string, string> =
    snapshots[0].cumulative_volumes;
  const prevCumulativeVolumes: Record<string, string> =
    snapshots[1].cumulative_volumes;
  const totalVolume = Number(
    Object.values(lastCumulativeVolumes).reduce(
      (acc, current) => acc + BigInt(current),
      BigInt(0)
    ) / BigInt(10 ** 18)
  );
  const totalVolumeOneDayAgo = Number(
    Object.values(prevCumulativeVolumes).reduce(
      (acc, current) => acc + BigInt(current),
      BigInt(0)
    ) / BigInt(10 ** 18)
  );
  const dailyVolume = totalVolume - totalVolumeOneDayAgo;
  return {
    totalVolume: totalVolume ? `${totalVolume}` : undefined,
    dailyVolume: dailyVolume ? `${dailyVolume}` : undefined,
    timestamp: timestamp,
  };
};

const fetchSpots = async (timeStamp: number) => {
  const spotProductIds = (await fetchProducts()).spot_products;
  return await computeVolume(timeStamp, spotProductIds);
};

const fetchPerps = async (timeStamp: number) => {
  const perpProductIds = (await fetchProducts()).perp_products;
  const marginedProductIds = (await fetchProducts()).margined_products;
  return await computeVolume(
    timeStamp,
    perpProductIds.concat(marginedProductIds)
  );
};

const startTime = 1682514000;

const adapter: BreakdownAdapter = {
  breakdown: {
    swap: {
      [CHAIN.ARBITRUM]: {
        fetch: fetchSpots,
        start: async () => startTime,
      },
    },
    derivatives: {
      [CHAIN.ARBITRUM]: {
        fetch: fetchPerps,
        start: async () => startTime,
      },
    },
  },
};

export default adapter;
