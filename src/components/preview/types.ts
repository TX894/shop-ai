export interface PreviewImage {
  id: string;
  role: string;
  originalUrl: string;
  resultBase64?: string;
  resultMime?: string;
  aiGenerated: boolean;
  error?: string;
  approved: boolean;
  prompt?: string;
  versions?: { base64: string; mime: string }[];
  currentVersion: number;
}

export interface PreviewProduct {
  handle: string;
  title: string;
  originalTitle: string;
  description: string;
  originalDescription: string;
  vendor: string;
  productType: string;
  price: string;
  images: PreviewImage[];
  included: boolean;
  collectionIds: string[];
  tags: string[];
}

export interface PreviewState {
  products: PreviewProduct[];
  aiCostUsed: number;
}

export type PreviewAction =
  | { type: "SET_PRODUCTS"; products: PreviewProduct[] }
  | { type: "UPDATE_TITLE"; productIdx: number; title: string }
  | { type: "RESET_TITLE"; productIdx: number }
  | { type: "UPDATE_DESCRIPTION"; productIdx: number; description: string }
  | { type: "RESET_DESCRIPTION"; productIdx: number }
  | { type: "UPDATE_PRICE"; productIdx: number; price: string }
  | { type: "TOGGLE_INCLUDED"; productIdx: number }
  | { type: "APPROVE_IMAGE"; productIdx: number; imageIdx: number }
  | { type: "REJECT_IMAGE"; productIdx: number; imageIdx: number }
  | { type: "APPROVE_ALL" }
  | { type: "DISCARD_IMAGE"; productIdx: number; imageIdx: number }
  | { type: "MOVE_IMAGE"; productIdx: number; fromIdx: number; toIdx: number }
  | { type: "REPLACE_IMAGE"; productIdx: number; imageIdx: number; base64: string; mime: string; prompt?: string }
  | { type: "UPDATE_TAGS"; productIdx: number; tags: string[] }
  | { type: "UPDATE_COLLECTIONS"; productIdx: number; collectionIds: string[] }
  | { type: "ADD_AI_COST"; cost: number }
  | { type: "RESTORE"; state: PreviewState };

export function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case "SET_PRODUCTS":
      return { ...state, products: action.products };

    case "UPDATE_TITLE":
      return {
        ...state,
        products: state.products.map((p, i) =>
          i === action.productIdx ? { ...p, title: action.title } : p
        ),
      };

    case "RESET_TITLE":
      return {
        ...state,
        products: state.products.map((p, i) =>
          i === action.productIdx ? { ...p, title: p.originalTitle } : p
        ),
      };

    case "UPDATE_DESCRIPTION":
      return {
        ...state,
        products: state.products.map((p, i) =>
          i === action.productIdx ? { ...p, description: action.description } : p
        ),
      };

    case "RESET_DESCRIPTION":
      return {
        ...state,
        products: state.products.map((p, i) =>
          i === action.productIdx ? { ...p, description: p.originalDescription } : p
        ),
      };

    case "UPDATE_PRICE":
      return {
        ...state,
        products: state.products.map((p, i) =>
          i === action.productIdx ? { ...p, price: action.price } : p
        ),
      };

    case "TOGGLE_INCLUDED":
      return {
        ...state,
        products: state.products.map((p, i) =>
          i === action.productIdx ? { ...p, included: !p.included } : p
        ),
      };

    case "APPROVE_IMAGE":
      return {
        ...state,
        products: state.products.map((p, pi) =>
          pi === action.productIdx
            ? {
                ...p,
                images: p.images.map((img, ii) =>
                  ii === action.imageIdx ? { ...img, approved: true } : img
                ),
              }
            : p
        ),
      };

    case "REJECT_IMAGE":
      return {
        ...state,
        products: state.products.map((p, pi) =>
          pi === action.productIdx
            ? {
                ...p,
                images: p.images.map((img, ii) =>
                  ii === action.imageIdx ? { ...img, approved: false } : img
                ),
              }
            : p
        ),
      };

    case "APPROVE_ALL":
      return {
        ...state,
        products: state.products.map((p) => ({
          ...p,
          images: p.images.map((img) => (img.resultBase64 ? { ...img, approved: true } : img)),
        })),
      };

    case "DISCARD_IMAGE":
      return {
        ...state,
        products: state.products.map((p, pi) =>
          pi === action.productIdx
            ? { ...p, images: p.images.filter((_, ii) => ii !== action.imageIdx) }
            : p
        ),
      };

    case "MOVE_IMAGE": {
      return {
        ...state,
        products: state.products.map((p, pi) => {
          if (pi !== action.productIdx) return p;
          const imgs = [...p.images];
          const [moved] = imgs.splice(action.fromIdx, 1);
          imgs.splice(action.toIdx, 0, moved);
          // Update roles based on position
          const roles = ["hero", "detail", "lifestyle"];
          return { ...p, images: imgs.map((img, i) => ({ ...img, role: roles[i] ?? "lifestyle" })) };
        }),
      };
    }

    case "REPLACE_IMAGE":
      return {
        ...state,
        products: state.products.map((p, pi) =>
          pi === action.productIdx
            ? {
                ...p,
                images: p.images.map((img, ii) => {
                  if (ii !== action.imageIdx) return img;
                  const versions = [...(img.versions ?? [])];
                  if (img.resultBase64) {
                    versions.push({ base64: img.resultBase64, mime: img.resultMime ?? "image/png" });
                  }
                  if (versions.length > 3) versions.shift();
                  return {
                    ...img,
                    resultBase64: action.base64,
                    resultMime: action.mime,
                    aiGenerated: true,
                    approved: true,
                    prompt: action.prompt ?? img.prompt,
                    versions,
                    currentVersion: versions.length,
                  };
                }),
              }
            : p
        ),
      };

    case "UPDATE_TAGS":
      return {
        ...state,
        products: state.products.map((p, i) =>
          i === action.productIdx ? { ...p, tags: action.tags } : p
        ),
      };

    case "UPDATE_COLLECTIONS":
      return {
        ...state,
        products: state.products.map((p, i) =>
          i === action.productIdx ? { ...p, collectionIds: action.collectionIds } : p
        ),
      };

    case "ADD_AI_COST":
      return { ...state, aiCostUsed: state.aiCostUsed + action.cost };

    case "RESTORE":
      return action.state;

    default:
      return state;
  }
}
