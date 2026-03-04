import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FavoritesState {
  favorites: string[]
  toggleFavorite: (pairKey: string) => void
  isFavorite: (pairKey: string) => boolean
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],
      toggleFavorite: (pairKey) =>
        set((state) => ({
          favorites: state.favorites.includes(pairKey)
            ? state.favorites.filter((k) => k !== pairKey)
            : [...state.favorites, pairKey],
        })),
      isFavorite: (pairKey) => get().favorites.includes(pairKey),
    }),
    { name: 'mega-quant-favorites' }
  )
)
