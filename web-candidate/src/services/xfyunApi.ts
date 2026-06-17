import { apiGetData } from '../config/api'

export type XfyunIatAuth = {
  wsUrl: string
  appId: string
}

export async function fetchXfyunIatAuth(): Promise<XfyunIatAuth> {
  return apiGetData<XfyunIatAuth>('/api/candidate/xfyun/iat-auth')
}
