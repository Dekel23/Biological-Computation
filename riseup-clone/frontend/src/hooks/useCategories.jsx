import { createContext, useContext, useMemo } from 'react'
import { api } from '../api'
import { useApi } from './useApi'

const CategoriesContext = createContext({ list: [], byKey: {}, loading: true })

export function CategoriesProvider({ children }) {
  const { data, loading } = useApi(() => api.categories(), [])
  const value = useMemo(() => {
    const list = data ?? []
    return { list, byKey: Object.fromEntries(list.map((c) => [c.key, c])), loading }
  }, [data, loading])
  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>
}

export const useCategories = () => useContext(CategoriesContext)
