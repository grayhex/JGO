// Original synthetic VPL XML for plumbing/negative tests. No Nokia firmware or FPSX bytes.
export function factoryManifest(variants = [{ label: 'Synthetic test', product: '0000000', files: ['core.fpsx'] }]) {
  return `<?xml version="1.0" encoding="UTF-8"?><VariantPackingList>${variants.map(v => `<Variant><VariantIdentification><Description>${v.label}</Description><ProductCode>${v.product}</ProductCode></VariantIdentification><FileList>${v.files.map(name => `<File><FileType>Binary</FileType><FileSubType>Mcu</FileSubType><Name>${name}</Name></File>`).join('')}</FileList></Variant>`).join('')}</VariantPackingList>`;
}
