import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { getSocket } from '../lib/socket'
import type { WorkspacePlace, WorkspacePlaceInput } from '../lib/types'

function sortPlaces(places: WorkspacePlace[]) {
  return [...places].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  )
}

export function useWorkspacePlaces() {
  const [places, setPlaces] = useState<WorkspacePlace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await api.places.list()
      setPlaces(sortPlaces(response.places))
      setError(null)
    } catch {
      setError('Saved places could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const socket = getSocket()
    const onChanged = () => void refresh()
    socket.on('workspace:places_changed', onChanged)
    socket.io.on('reconnect', onChanged)
    return () => {
      socket.off('workspace:places_changed', onChanged)
      socket.io.off('reconnect', onChanged)
    }
  }, [refresh])

  const createPlace = useCallback(async (input: WorkspacePlaceInput) => {
    const { place } = await api.places.create(input)
    setPlaces((current) => sortPlaces([...current.filter((item) => item.id !== place.id), place]))
    return place
  }, [])

  const updatePlace = useCallback(async (id: string, patch: Partial<WorkspacePlaceInput>) => {
    const { place } = await api.places.update(id, patch)
    setPlaces((current) => sortPlaces(current.map((item) => (item.id === id ? place : item))))
    return place
  }, [])

  const deletePlace = useCallback(async (id: string) => {
    await api.places.delete(id)
    setPlaces((current) => current.filter((item) => item.id !== id))
  }, [])

  return { places, loading, error, refresh, createPlace, updatePlace, deletePlace }
}
