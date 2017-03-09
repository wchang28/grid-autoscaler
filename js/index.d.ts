/// <reference types="es6-promise" />
/// <reference types="node" />
import * as events from "events";
import * as asg from 'autoscalable-grid';
export declare type WorkerKey = string;
export interface IWorkersLaunchRequest {
    NumInstance: number;
    Hint?: any;
}
export interface IAutoScalerImplementation {
    TranslateToWorkerKeys: (workers: asg.IWorker[]) => Promise<WorkerKey[]>;
    ComputeWorkersLaunchRequest: (state: asg.IAutoScalableState) => Promise<IWorkersLaunchRequest>;
    LaunchInstances: (launchRequest: IWorkersLaunchRequest) => Promise<WorkerKey[]>;
    TerminateInstances: (workers: asg.IWorker[]) => Promise<WorkerKey[]>;
    getConfigUrl: () => Promise<string>;
}
export interface Options {
    EnabledAtStart?: boolean;
    MaxAllowedWorkers?: number;
    PollingIntervalMS?: number;
    TerminateWorkerAfterMinutesIdle?: number;
}
export interface IGridAutoScalerJSON {
    Scaling: boolean;
    Enabled: boolean;
    HasWorkersCap: boolean;
    MaxAllowedWorkers: number;
    LaunchingWorkers: WorkerKey[];
    TerminatingWorkers: WorkerKey[];
}
export interface IGridAutoScaler {
    isScaling: () => Promise<boolean>;
    isEnabled: () => Promise<boolean>;
    hasWorkersCap: () => Promise<boolean>;
    enable: () => Promise<any>;
    disable: () => Promise<any>;
    getMaxAllowedWorkers: () => Promise<number>;
    setMaxAllowedWorkers: (value: number) => Promise<any>;
    getLaunchingWorkers: () => Promise<WorkerKey[]>;
    getTerminatingWorkers: () => Promise<WorkerKey[]>;
    getJSON: () => Promise<IGridAutoScalerJSON>;
    getImplementationConfigUrl: () => Promise<string>;
}
export declare class GridAutoScaler extends events.EventEmitter {
    private scalableGrid;
    private implementation;
    private options;
    private __enabled;
    private __MaxAllowedWorkers;
    private __terminatingWorkers;
    private __launchingWorkers;
    constructor(scalableGrid: asg.IAutoScalableGrid, implementation: IAutoScalerImplementation, options?: Options);
    readonly Scaling: boolean;
    readonly LaunchingWorkers: WorkerKey[];
    readonly TerminatingWorkers: WorkerKey[];
    Enabled: boolean;
    readonly HasWorkersCap: boolean;
    MaxAllowedWorkers: number;
    private getWorkerFromState(state);
    private getDownScalingPromise(state);
    private getUpScalingWithTaskDebtPromise(state);
    private getUpScalingPromise(state);
    private feedLastestWorkerStates(workerStates);
    private readonly AutoScalingPromise;
    private readonly TimerFunction;
    readonly ImplementationConfigUrl: Promise<string>;
    toJSON(): IGridAutoScalerJSON;
}
