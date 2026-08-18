import axios, { type AxiosInstance } from "axios";
import { getToken } from "./AuthSDK/client";

const g = globalThis as unknown as { __api?: AxiosInstance };

export const api: AxiosInstance = (g.__api ??= (() => {
    const instance = axios.create({
        baseURL: import.meta.env.VITE_CONTROL_PLANE_URL || "/",
    });

    instance.interceptors.request.use(async (config) => {
        const token = await getToken();

        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
    });

    instance.interceptors.response.use(
        (response) => response,
        (error) => {
            if (error.response?.status === 401) {
                console.warn("Control plane rejected token.");
            }

            return Promise.reject(error);
        }
    );

    return instance;
})());

if (import.meta.hot) import.meta.hot.accept();
