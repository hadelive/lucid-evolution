import { Assets, OutRef, TxOutput, UTxO } from "@lucid-evolution/core-types";
import { CML } from "./core.js";
import { fromScriptRef, toScriptRef } from "./scripts.js";
import { assetsToValue, valueToAssets } from "./value.js";

export const utxoToTransactionOutput = (utxo: UTxO) => {
  const buildDatum = (utxo: UTxO, builder: CML.TransactionOutputBuilder) => {
    //TODO: test with DatumHash
    if (utxo.datumHash)
      return builder.with_data(
        CML.DatumOption.new_hash(CML.DatumHash.from_hex(utxo.datumHash)),
      );
    // inline datum
    if (utxo.datum)
      return builder.with_data(
        CML.DatumOption.new_datum(CML.PlutusData.from_cbor_hex(utxo.datum)),
      );
    return builder;
  };

  const buildOutput = (utxo: UTxO) => {
    const builder = CML.TransactionOutputBuilder.new().with_address(
      CML.Address.from_bech32(utxo.address),
    );
    return utxo.scriptRef
      ? buildDatum(utxo, builder)
          .with_reference_script(toScriptRef(utxo.scriptRef))
          .next()
      : buildDatum(utxo, builder).next();
  };

  return buildOutput(utxo)
    .with_value(assetsToValue(utxo.assets))
    .build()
    .output();
};

export const utxoToTransactionInput = (utxo: UTxO) => {
  return CML.TransactionInput.new(
    CML.TransactionHash.from_hex(utxo.txHash),
    BigInt(utxo.outputIndex),
  );
};

export const utxoToCore = (utxo: UTxO): CML.TransactionUnspentOutput => {
  const out = utxoToTransactionOutput(utxo);
  const utxoCore = CML.TransactionUnspentOutput.new(
    utxoToTransactionInput(utxo),
    out,
  );
  // out.free();
  return utxoCore;
};

export function utxosToCores(utxos: UTxO[]): CML.TransactionUnspentOutput[] {
  const result: CML.TransactionUnspentOutput[] = [];
  for (const utxo of utxos) {
    result.push(utxoToCore(utxo));
  }
  return result;
}

//TODO: test coreToUtxo -> utxoToCore strict equality
export function coreToUtxo(coreUtxo: CML.TransactionUnspentOutput): UTxO {
  const out = CML.TransactionOutput.from_cbor_hex(coreUtxo.to_cbor_hex());
  const utxo = {
    ...coreToOutRef(CML.TransactionInput.from_cbor_hex(coreUtxo.to_cbor_hex())),
    ...coreToTxOutput(out),
  };
  return utxo;
}

export function coresToUtxos(utxos: CML.TransactionUnspentOutput[]): UTxO[] {
  const result: UTxO[] = [];
  for (let i = 0; i < utxos.length; i++) {
    result.push(coreToUtxo(utxos[i]));
  }
  return result;
}

export function coreToOutRef(input: CML.TransactionInput): OutRef {
  return {
    txHash: input.transaction_id().to_hex(),
    outputIndex: parseInt(input.index().toString()),
  };
}

export function coresToOutRefs(inputs: CML.TransactionInput[]): OutRef[] {
  const result: OutRef[] = [];
  for (let i = 0; i < inputs.length; i++) {
    result.push(coreToOutRef(inputs[i]));
  }
  return result;
}

export function coreToTxOutput(output: CML.TransactionOutput): TxOutput {
  return {
    assets: valueToAssets(output.amount()),
    address: output.address().to_bech32(undefined),
    datumHash: output.datum()?.as_hash()?.to_hex(),
    datum: output.datum()?.as_datum()?.to_cbor_hex(),
    scriptRef: output.script_ref() && fromScriptRef(output.script_ref()!),
  };
}

export function coresToTxOutputs(outputs: CML.TransactionOutput[]): TxOutput[] {
  let result: TxOutput[] = [];
  for (let i = 0; i < outputs.length; i++) {
    result.push(coreToTxOutput(outputs[i]));
  }
  return result;
}

//TODO: disable for now
// export function producedUtxosFrom(unsignedTx: TxComplete): UTxO[] {
//   const result: UTxO[] = [];
//   const hash = unsignedTx.toHash();
//   const outputs = unsignedTx.txComplete.body().outputs();
//   const outputsArray = new Array<CML.TransactionOutput>(outputs.len()).map(
//     (_, index) => outputs.get(index),
//   );
//   coresToTxOutputs(outputsArray).forEach((output, index) => {
//     result.push({
//       outputIndex: index,
//       txHash: hash,
//       ...output,
//     });
//   });
//   return result;
// }

export const selectUTxOs = (utxos: UTxO[], totalAssets: Assets) => {
  const selectedUtxos: UTxO[] = [];
  let isSelected = false;
  const assetsRequired = new Map<string, bigint>(Object.entries(totalAssets));
  for (const utxo of utxos) {
    isSelected = false;
    for (const [unit, amount] of assetsRequired) {
      if (Object.hasOwn(utxo.assets, unit)) {
        const utxoAmount = utxo.assets[unit];
        if (utxoAmount >= amount) {
          assetsRequired.delete(unit);
        } else {
          assetsRequired.set(unit, amount - utxoAmount);
        }
        isSelected = true;
      }
    }
    if (isSelected) {
      selectedUtxos.push(utxo);
    }
    if (assetsRequired.size == 0) {
      break;
    }
  }
  if (assetsRequired.size > 0) return [];
  return selectedUtxos;
};

/**
 * Sorts an array of UTXOs by the amount of "lovelace" in ascending or descending order.
 *
 * @param {UTxO[]} utxos - The array of UTXO objects to be sorted.
 * @param {"ascending" | "descending"} [order="descending"] - The order in which to sort the UTXOs.
 *      Use "ascending" for ascending order and "descending" for descending order.
 * @returns {UTxO[]} - The sorted array of UTXOs.
 *
 */
export const sortUTxOs = (
  utxos: UTxO[],
  order: "ascending" | "descending" = "descending",
): UTxO[] => {
  return [...utxos].sort((a, b) => {
    if (a.assets["lovelace"] > b.assets["lovelace"]) {
      return order === "ascending" ? 1 : -1;
    }
    if (a.assets["lovelace"] < b.assets["lovelace"]) {
      return order === "ascending" ? -1 : 1;
    }
    return 0;
  });
};

export const isEqualUTxO = (self: UTxO, that: UTxO) =>
  self.txHash === that.txHash && self.outputIndex === that.outputIndex;

//TODO: add
// sortCanonical -> sorting following ledger rules
// sortBy -> sort by amount of specific unit
